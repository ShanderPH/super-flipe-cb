// The native catalog and RetroArch hand off the same webOS process via exec.
#include <arpa/inet.h>
#include <curl/curl.h>
#include <fcntl.h>
#include <json-c/json.h>
#include <openssl/evp.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#include <array>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <regex>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;
namespace {
constexpr std::size_t max_rom = 16 * 1024 * 1024;
constexpr const char *core_build =
    "snes9x-fae2fea08f74180759ef540ee94259213f503480";
using Json = std::unique_ptr<json_object, decltype(&json_object_put)>;
using Curl = std::unique_ptr<CURL, decltype(&curl_easy_cleanup)>;
using Digest = std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)>;

void require(bool ok, const std::string &message) {
  if (!ok)
    throw std::runtime_error(message);
}

Json parse(const std::string &text) {
  std::unique_ptr<json_tokener, decltype(&json_tokener_free)> tok(
      json_tokener_new(), json_tokener_free);
  require(bool(tok), "JSON allocation failed");
  json_tokener_set_flags(tok.get(),
                         JSON_TOKENER_STRICT | JSON_TOKENER_VALIDATE_UTF8);
  Json result(json_tokener_parse_ex(tok.get(), text.data(),
                                    static_cast<int>(text.size())),
              json_object_put);
  require(result && json_tokener_get_error(tok.get()) == json_tokener_success &&
              json_tokener_get_parse_end(tok.get()) == text.size() &&
              json_object_is_type(result.get(), json_type_object),
          "Invalid JSON object");
  return result;
}

json_object *member(json_object *obj, const char *key, json_type type) {
  json_object *value = nullptr;
  require(json_object_object_get_ex(obj, key, &value) &&
              json_object_is_type(value, type),
          std::string("Invalid field: ") + key);
  return value;
}

std::string string_field(json_object *obj, const char *key) {
  auto *value = member(obj, key, json_type_string);
  std::string result(json_object_get_string(value),
                     json_object_get_string_len(value));
  require(result.find('\0') == std::string::npos, "NUL in string");
  return result;
}

std::string read_file(const fs::path &path, std::size_t limit) {
  require(fs::is_regular_file(fs::symlink_status(path)),
          "Not a regular file: " + path.string());
  require(fs::file_size(path) <= limit, "File exceeds limit");
  std::ifstream file(path, std::ios::binary);
  require(bool(file), "Cannot read file");
  std::string result(limit + 1, '\0');
  file.read(result.data(), static_cast<std::streamsize>(result.size()));
  const auto bytes = static_cast<std::size_t>(file.gcount());
  require(!file.bad() && bytes <= limit, "File read failed or exceeds limit");
  result.resize(bytes);
  return result;
}

std::string server_origin(std::string origin) {
  const std::regex pattern(
      R"(^http://([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)(:([0-9]{1,5}))?/?$)");
  std::smatch m;
  require(std::regex_match(origin, m, pattern),
          "Use an HTTP origin with a private IPv4 literal");
  in_addr address{};
  require(inet_pton(AF_INET, m[1].str().c_str(), &address) == 1,
          "Invalid IPv4");
  const auto ip = ntohl(address.s_addr);
  require((ip >> 24) == 10 || (ip >> 20) == 0xac1 || (ip >> 16) == 0xc0a8 ||
              (ip >> 24) == 127,
          "Server must be on RFC1918 LAN or loopback");
  if (m[3].matched) {
    const auto port = std::stoul(m[3]);
    require(port > 0 && port <= 65535, "Invalid port");
  }
  if (origin.back() == '/')
    origin.pop_back();
  return origin;
}

void private_directory(const fs::path &path) {
  require(path.is_absolute(), "Directory must be absolute");
  fs::path current = path.root_path();
  for (const auto &part : path.relative_path()) {
    require(part != ".." && part != ".", "Invalid directory component");
    current /= part;
    const auto status = fs::symlink_status(current);
    if (!fs::exists(status)) {
      require(::mkdir(current.c_str(), 0700) == 0 || errno == EEXIST,
              "Cannot create directory");
    }
    require(fs::is_directory(fs::symlink_status(current)),
            "Directory contains link or non-directory");
  }
  // webOS package updates can reset preserved app directories to 0775. Repair
  // only directories already owned by this app; never adopt another UID's data.
  const int fd = ::open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat info {};
  const bool owned = fd >= 0 && ::fstat(fd, &info) == 0 &&
                     info.st_uid == ::geteuid();
  const bool secured = owned && ::fchmod(fd, 0700) == 0;
  if (fd >= 0)
    ::close(fd);
  require(secured, "Directory must belong to this user and permit private access");
}

void secure_userdata(const fs::path &state) {
  private_directory(state);
  for (const auto &entry : fs::recursive_directory_iterator(state)) {
    const auto status = entry.symlink_status();
    require(!fs::is_symlink(status), "User data contains a link; preserve and inspect it");
    if (fs::is_directory(status)) {
      private_directory(entry.path());
      continue;
    }
    require(fs::is_regular_file(status), "User data contains an unsupported file");
    const int fd = ::open(entry.path().c_str(), O_RDONLY | O_NOFOLLOW);
    struct stat info {};
    const bool secured = fd >= 0 && ::fstat(fd, &info) == 0 &&
                         info.st_uid == ::geteuid() && ::fchmod(fd, 0600) == 0;
    if (fd >= 0)
      ::close(fd);
    require(secured, "Cannot secure this app's preserved user data");
  }
}

struct Transfer {
  std::string body;
  int fd = -1;
  std::size_t size = 0;
  std::size_t limit = 0;
};

std::size_t write_body(char *ptr, std::size_t size, std::size_t count,
                       void *context) noexcept {
  auto &t = *static_cast<Transfer *>(context);
  if (size && count > std::numeric_limits<std::size_t>::max() / size)
    return 0;
  const auto bytes = size * count;
  if (bytes > t.limit - t.size)
    return 0;
  if (t.fd >= 0) {
    std::size_t written = 0;
    while (written < bytes) {
      auto n = ::write(t.fd, ptr + written, bytes - written);
      if (n < 0 && errno == EINTR)
        continue;
      if (n <= 0)
        return 0;
      written += static_cast<std::size_t>(n);
    }
  } else {
    try {
      t.body.append(ptr, bytes);
    } catch (...) {
      return 0;
    }
  }
  t.size += bytes;
  return bytes;
}

void get(const std::string &url, Transfer &t) {
  Curl curl(curl_easy_init(), curl_easy_cleanup);
  require(bool(curl), "HTTP allocation failed");
  auto set = [&](CURLoption option, auto value) {
    require(curl_easy_setopt(curl.get(), option, value) == CURLE_OK,
            "HTTP option failed");
  };
  set(CURLOPT_URL, url.c_str());
  set(CURLOPT_PROTOCOLS_STR, "http");
  set(CURLOPT_FOLLOWLOCATION, 0L);
  set(CURLOPT_PROXY, "");
  set(CURLOPT_CONNECTTIMEOUT, 5L);
  set(CURLOPT_TIMEOUT, 60L);
  set(CURLOPT_LOW_SPEED_LIMIT, 1024L);
  set(CURLOPT_LOW_SPEED_TIME, 10L);
  set(CURLOPT_NOSIGNAL, 1L);
  set(CURLOPT_WRITEFUNCTION, write_body);
  set(CURLOPT_WRITEDATA, &t);
  const auto status = curl_easy_perform(curl.get());
  require(status == CURLE_OK,
          std::string("HTTP transfer failed: ") + curl_easy_strerror(status));
  long code = 0;
  require(
      curl_easy_getinfo(curl.get(), CURLINFO_RESPONSE_CODE, &code) ==
              CURLE_OK &&
          code == 200,
      "HTTP status must be 200 (redirects and partial responses are rejected)");
}

std::string sha256(const fs::path &file) {
  Digest ctx(EVP_MD_CTX_new(), EVP_MD_CTX_free);
  require(ctx && EVP_DigestInit_ex(ctx.get(), EVP_sha256(), nullptr) == 1,
          "SHA256 initialization failed");
  std::ifstream stream(file, std::ios::binary);
  require(bool(stream), "Cannot hash file");
  std::array<char, 65536> chunk{};
  while (stream) {
    stream.read(chunk.data(), chunk.size());
    require(EVP_DigestUpdate(ctx.get(), chunk.data(),
                             static_cast<std::size_t>(stream.gcount())) == 1,
            "SHA256 update failed");
  }
  require(stream.eof(), "Hash read failed");
  std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
  unsigned length = 0;
  require(EVP_DigestFinal_ex(ctx.get(), digest.data(), &length) == 1 &&
              length == 32,
          "SHA256 failed");
  const char *hex = "0123456789abcdef";
  std::string out;
  for (unsigned i = 0; i < length; ++i) {
    out += hex[digest[i] >> 4];
    out += hex[digest[i] & 15];
  }
  return out;
}

std::string sha256_bytes(const std::string &bytes) {
  Digest ctx(EVP_MD_CTX_new(), EVP_MD_CTX_free);
  unsigned char hash[32];
  unsigned length = 0;
  require(ctx && EVP_DigestInit_ex(ctx.get(), EVP_sha256(), nullptr) == 1 &&
              EVP_DigestUpdate(ctx.get(), bytes.data(), bytes.size()) == 1 &&
              EVP_DigestFinal_ex(ctx.get(), hash, &length) == 1 && length == 32,
          "SHA256 failed");
  const char *hex = "0123456789abcdef";
  std::string result;
  for (auto byte : hash) {
    result += hex[byte >> 4];
    result += hex[byte & 15];
  }
  return result;
}

void prune_cache(const fs::path &cache, fs::path keep = {}) {
  for (const auto &entry : fs::directory_iterator(cache)) {
    if (!fs::is_regular_file(entry.symlink_status()) ||
        !std::regex_match(entry.path().filename().string(),
                          std::regex("snes-[0-9a-f]{64}\\.(sfc|smc)")))
      continue;
    if (keep.empty())
      keep = entry.path();
    if (entry.path() != keep)
      fs::remove(entry.path());
  }
}

fs::path prepare(const std::string &server, const std::string &id,
                 const fs::path &cache) {
  require(std::regex_match(id, std::regex("snes-[0-9a-f]{64}")),
          "Invalid SNES content ID");
  Transfer catalog{{}, -1, 0, 64 * 1024};
  get(server + "/api/games/" + id, catalog);
  auto game = parse(catalog.body);
  require(string_field(game.get(), "id") == id &&
              string_field(game.get(), "system") == "snes" &&
              string_field(game.get(), "core") == "snes9x",
          "Unsupported catalog entry");
  auto *media = member(game.get(), "media", json_type_object);
  const auto format = string_field(media, "format");
  require(format == "sfc" || format == "smc",
          "Only uncompressed SNES content is supported in P0");
  require(string_field(media, "url") == "/api/games/" + id + "/rom",
          "Unexpected media URL");
  const auto size =
      json_object_get_int64(member(media, "sizeBytes", json_type_int));
  require(size > 0 && size <= static_cast<std::int64_t>(max_rom),
          "ROM must be between 1 byte and 16 MiB");
  const auto content = cache / (id + "." + format);
  if (fs::exists(fs::symlink_status(content))) {
    require(fs::is_regular_file(fs::symlink_status(content)) &&
                fs::file_size(content) == static_cast<std::uint64_t>(size) &&
                sha256(content) == id.substr(5),
            "Existing cache failed integrity; preserve and inspect it");
    prune_cache(cache, content);
    return content;
  }
  // Recover a crash between committing a replacement and pruning its
  // predecessor. Keep at most one old completed ROM before allocating the next
  // download.
  prune_cache(cache);
  require(fs::space(cache).available >=
              static_cast<std::uint64_t>(size) + 1024 * 1024,
          "Insufficient temporary storage");
  // Exclusive temporary file: never follows a symlink or reuses interrupted
  // bytes.
  std::string pattern = (cache / ".download-XXXXXX").string();
  std::vector<char> name(pattern.begin(), pattern.end());
  name.push_back('\0');
  const int fd = ::mkstemp(name.data());
  require(fd >= 0, "Cannot create temporary download");
  bool open = true;
  try {
    Transfer download{{}, fd, 0, static_cast<std::size_t>(size)};
    get(server + "/api/games/" + id + "/rom", download);
    require(download.size == static_cast<std::size_t>(size), "Truncated ROM");
    require(::fsync(fd) == 0, "Cannot flush ROM");
    const int closed = ::close(fd);
    open = false;
    require(closed == 0 && sha256(name.data()) == id.substr(5),
            "ROM checksum mismatch");
    // link() is atomic and fails if a target appeared; no silent overwrite.
    require(::link(name.data(), content.c_str()) == 0,
            "Cache destination already exists or commit failed");
    ::unlink(name.data());
  } catch (...) {
    if (open)
      ::close(fd);
    ::unlink(name.data());
    throw;
  }
  // One completed ROM retained; at most two 16 MiB ROMs during replacement.
  prune_cache(cache, content);
  return content;
}

std::string quote(const fs::path &path) {
  const auto value = path.string();
  require(value.find_first_of("\"\r\n\\") == std::string::npos,
          "Unsafe configuration path");
  return "\"" + value + "\"";
}

void write_config(const fs::path &path, const std::string &config) {
  const int fd =
      ::open(path.c_str(), O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600);
  require(fd >= 0, "Cannot create session config");
  auto left = config.size();
  const char *data = config.data();
  while (left) {
    const auto written = ::write(fd, data, left);
    if (written < 0 && errno == EINTR)
      continue;
    if (written <= 0) {
      ::close(fd);
      throw std::runtime_error("Config write failed");
    }
    left -= static_cast<std::size_t>(written);
    data += written;
  }
  const int flushed = ::fsync(fd);
  const int closed = ::close(fd);
  require(flushed == 0 && closed == 0, "Config flush failed");
}
} // namespace

#include "frontend.inc"

int main(int argc, char **argv) {
  try {
    const auto started = std::chrono::steady_clock::now();
    const auto app = fs::canonical("/proc/self/exe").parent_path();
    fs::path state = app / "userdata";
    // webOS mounts /tmp without write access for native apps; /dev/shm is
    // tmpfs.
    fs::path cache = fs::path("/dev/shm") /
                     ("superflipcb-native-" + std::to_string(::geteuid()));
    fs::path session =
        fs::is_regular_file(fs::symlink_status(state / "session.json"))
            ? state / "session.json"
            : app / "session.json";
    bool prepare_only = false, session_explicit = false;
    for (int i = 1; i < argc; ++i) {
      const std::string arg = argv[i];
      if (arg == "--prepare-only")
        prepare_only = true;
      else if (arg == "--state-dir" && i + 1 < argc)
        state = argv[++i];
      else if (arg == "--cache-dir" && i + 1 < argc)
        cache = argv[++i];
      else if (arg == "--session" && i + 1 < argc) {
        session = argv[++i];
        session_explicit = true;
      } else if (arg == "--help") {
        std::cout << "superflip-native [--session FILE] [--state-dir ABS] "
                     "[--cache-dir ABS] [--prepare-only]\n";
        return 0;
      } else if (i == 1 && arg.size() && arg.front() == '{') {
        // webOS app manager passes a launch-parameter JSON argument.
        require(arg.size() <= 4096, "Launch parameters exceed limit");
        auto ignored =
            parse(arg); // Never used to override paths, server or core.
        auto *launch = ignored.get();
        json_object *parameters = nullptr;
        if (json_object_object_get_ex(launch, "parameters", &parameters)) {
          require(json_object_is_type(parameters, json_type_object),
                  "Invalid native launch envelope");
          launch = parameters;
        }
        json_object *game = nullptr;
        json_object *frames = nullptr;
        json_object *backup = nullptr;
        if (json_object_object_get_ex(launch, "backupOnly", &backup)) {
          require(json_object_is_type(backup, json_type_boolean),
                  "Invalid backup parameter");
          if (json_object_get_boolean(backup))
            ::setenv("SFCB_BACKUP_ONLY", "1", 1);
        }
        if (json_object_object_get_ex(launch, "gameId", &game)) {
          const auto id = string_field(launch, "gameId");
          require(std::regex_match(id, std::regex("(snes|ps1)-[0-9a-f]{64}")),
                  "Invalid launch game");
          ::setenv("SFCB_START_GAME", id.c_str(), 1);
        }
        if (json_object_object_get_ex(launch, "testFrames", &frames)) {
          require(json_object_is_type(frames, json_type_int) &&
                      json_object_get_int(frames) > 0 &&
                      json_object_get_int(frames) <= 36000,
                  "Invalid smoke frame limit");
          ::setenv("SFCB_TEST_FRAMES",
                   std::to_string(json_object_get_int(frames)).c_str(), 1);
        }
      } else
        throw std::runtime_error("Unknown argument: " + arg);
    }
    if (!session_explicit &&
        fs::is_regular_file(fs::symlink_status(state / "session.json")))
      session = state / "session.json";
    secure_userdata(state);
    if (fs::is_regular_file(fs::symlink_status(session))) {
      auto settings = parse(read_file(session, 4096));
      json_object *token = nullptr;
      if (json_object_object_get_ex(settings.get(), "token", &token)) {
        require(curl_global_init(CURL_GLOBAL_DEFAULT) == CURLE_OK,
                "HTTP initialization failed");
        const int code = native_frontend(app, state, cache, session);
        curl_global_cleanup();
        return code;
      }
    }
    private_directory(state);
    private_directory(cache);
    const int lock = ::open((cache / "session.lock").c_str(),
                            O_CREAT | O_RDWR | O_NOFOLLOW, 0600);
    require(lock >= 0 && ::flock(lock, LOCK_EX | LOCK_NB) == 0,
            "Another native session is using this cache");
    // Deliberately inherited across execv, so the lock covers the entire game.
    for (const auto &entry : fs::directory_iterator(cache)) {
      if (fs::is_regular_file(entry.symlink_status()) &&
          std::regex_match(entry.path().filename().string(),
                           std::regex("\\.download-[A-Za-z0-9]{6}")))
        fs::remove(entry.path());
    }
    fs::path content;
    std::string id = "no-content";
    require(curl_global_init(CURL_GLOBAL_DEFAULT) == CURLE_OK,
            "HTTP initialization failed");
    if (fs::exists(fs::symlink_status(session))) {
      auto settings = parse(read_file(session, 4096));
      id = string_field(settings.get(), "gameId");
      const auto server = server_origin(string_field(settings.get(), "server"));
      content = prepare(server, id, cache);
    } else
      require(!prepare_only, "Provide --session for --prepare-only");
    curl_global_cleanup();
    const auto core_path = app / "cores/snes9x_libretro.so";
    require(fs::is_regular_file(fs::symlink_status(core_path)),
            "Missing packaged native core");
    const auto build_identity =
        std::string(core_build) + "-" + sha256(core_path);
    const auto saves = state / build_identity / id;
    private_directory(saves);
    private_directory(state / "system");
    private_directory(state / "config");
    const auto config_path = cache / "session.cfg";
    if (fs::exists(fs::symlink_status(config_path))) {
      require(fs::is_regular_file(fs::symlink_status(config_path)),
              "Unsafe session config");
      fs::remove(config_path);
    }
    auto config = read_file(app / "retroarch.cfg", 64 * 1024);
    config += "\nsavefile_directory = " + quote(saves) +
              "\nsavestate_directory = " + quote(saves) +
              "\nsystem_directory = " + quote(state / "system") +
              "\nlibretro_directory = " + quote(app / "cores") + "\n";
    write_config(config_path, config);
    const auto preparation_ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started)
            .count();
    std::cout << "native-poc core=" << build_identity << " content=" << id
              << " saves=" << saves << " preparationMs=" << preparation_ms
              << std::endl;
    if (prepare_only)
      return 0;
    require(::setenv("XDG_CONFIG_HOME", (state / "config").c_str(), 1) == 0,
            "Cannot isolate config");
    require(::setenv("SDL_APP_ID", "com.superflipcb.native", 1) == 0,
            "Cannot set SDL app ID");
    std::vector<std::string> args{(app / "retroarch").string(), "--verbose",
                                  "--config", config_path.string()};
    if (!content.empty()) {
      args.insert(args.end(), {"-L", core_path.string(), content.string()});
    } else
      args.push_back("--menu");
    std::vector<char *> pointers;
    for (auto &arg : args)
      pointers.push_back(arg.data());
    pointers.push_back(nullptr);
    ::execv(pointers[0], pointers.data());
    throw std::runtime_error(std::string("Cannot execute RetroArch: ") +
                             std::strerror(errno));
  } catch (const std::exception &error) {
    std::cerr << "native-poc: " << error.what() << '\n';
    return 1;
  }
}
