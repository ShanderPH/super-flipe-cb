// Native product flow; included beside the preparation helpers in main.cpp.
#include <SDL2/SDL.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include <functional>
#include <future>
#include <map>
#include <signal.h>
#include <thread>
#include "stick_navigation.h"

namespace {
volatile sig_atomic_t quit_requested = 0;
void request_quit(int) { quit_requested = 1; }
struct SDLSession {
  SDLSession() {
    SDL_SetHint(SDL_HINT_NO_SIGNAL_HANDLERS, "1");
    SDL_SetHint("SDL_WEBOS_ACCESS_POLICY_KEYS_BACK", "true");
    SDL_SetHint("SDL_WEBOS_ACCESS_POLICY_KEYS_EXIT", "true");
    require(SDL_Init(SDL_INIT_EVENTS | SDL_INIT_VIDEO) == 0, SDL_GetError());
    ::signal(SIGTERM, request_quit);
    ::signal(SIGINT, request_quit);
  }
  ~SDLSession() { SDL_Quit(); }
};
void recover_orphan_runtime(const fs::path &app) {
  // Compatibility cleanup for earlier launchers, under the app's own UID.
  // Never signal a baseline core or a process belonging to another app/user.
  const auto expected = (app / "retroarch").string();
  for (const auto &entry : fs::directory_iterator("/proc")) {
    auto id = entry.path().filename().string();
    if (!std::regex_match(id, std::regex("[0-9]+")))
      continue;
    struct stat owner {};
    if (::stat(entry.path().c_str(), &owner) != 0 ||
        owner.st_uid != ::geteuid())
      continue;
    std::error_code error;
    auto executable = fs::read_symlink(entry.path() / "exe", error).string();
    if (error ||
        (executable != expected && executable != expected + " (deleted)"))
      continue;
    std::ifstream status(entry.path() / "status");
    std::string line;
    bool orphan = false;
    while (std::getline(status, line))
      if (line.rfind("PPid:", 0) == 0) {
        std::istringstream fields(line.substr(5));
        int parent = 0;
        fields >> parent;
        orphan = parent == 1;
        break;
      }
    if (!orphan)
      continue;
    const auto pid = static_cast<pid_t>(std::stol(id));
    require(::kill(pid, SIGINT) == 0 || errno == ESRCH,
            "Não foi possível encerrar runtime anterior");
    for (int attempt = 0; attempt < 100; ++attempt) {
      if (::kill(pid, 0) != 0)
        break;
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
  }
}
struct Reply {
  long code = 0;
  std::string data, etag, bios, digest;
};
size_t api_header(char *ptr, size_t size, size_t count, void *user) {
  auto &r = *static_cast<Reply *>(user);
  std::string text(ptr, size * count);
  auto colon = text.find(':');
  if (colon != std::string::npos) {
    auto key = text.substr(0, colon);
    for (auto &c : key)
      c = static_cast<char>(std::tolower(c));
    auto value = text.substr(colon + 1);
    auto begin = value.find_first_not_of(" \t");
    auto end = value.find_last_not_of("\r\n \t");
    if (begin != std::string::npos && end != std::string::npos)
      value = value.substr(begin, end - begin + 1);
    if (key == "etag")
      r.etag = value;
    if (key == "x-bios-name")
      r.bios = value;
    if (key == "x-save-sha256")
      r.digest = value;
  }
  return size * count;
}
Reply native_api(const std::string &server, const std::string &token,
                 const std::string &path, const std::string &body = {},
                 const std::string &expected = {}) {
  require(path.rfind("/api/", 0) == 0 && path.find("..") == std::string::npos,
          "Invalid API path");
  Curl curl(curl_easy_init(), curl_easy_cleanup);
  require(bool(curl), "HTTP initialization failed");
  Reply reply;
  Transfer output{{}, -1, 0, 16 * 1024 * 1024};
  auto headers =
      curl_slist_append(nullptr, ("X-Native-Token: " + token).c_str());
  if (!expected.empty()) {
    headers = curl_slist_append(headers, "X-Super-Flip: 1");
    headers =
        curl_slist_append(headers, "Content-Type: application/octet-stream");
    headers = curl_slist_append(headers, ("If-Match: " + expected).c_str());
    headers = curl_slist_append(
        headers, ("X-Save-SHA256: " + sha256_bytes(body)).c_str());
    curl_easy_setopt(curl.get(), CURLOPT_CUSTOMREQUEST, "PUT");
    curl_easy_setopt(curl.get(), CURLOPT_POSTFIELDS, body.data());
    curl_easy_setopt(curl.get(), CURLOPT_POSTFIELDSIZE_LARGE,
                     static_cast<curl_off_t>(body.size()));
  }
  curl_easy_setopt(curl.get(), CURLOPT_URL, (server + path).c_str());
  curl_easy_setopt(curl.get(), CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl.get(), CURLOPT_PROTOCOLS_STR, "http");
  curl_easy_setopt(curl.get(), CURLOPT_FOLLOWLOCATION, 0L);
  curl_easy_setopt(curl.get(), CURLOPT_PROXY, "");
  curl_easy_setopt(curl.get(), CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(curl.get(), CURLOPT_CONNECTTIMEOUT, 3L);
  curl_easy_setopt(curl.get(), CURLOPT_TIMEOUT, 15L);
  curl_easy_setopt(curl.get(), CURLOPT_WRITEFUNCTION, write_body);
  curl_easy_setopt(curl.get(), CURLOPT_WRITEDATA, &output);
  curl_easy_setopt(curl.get(), CURLOPT_HEADERFUNCTION, api_header);
  curl_easy_setopt(curl.get(), CURLOPT_HEADERDATA, &reply);
  auto status = curl_easy_perform(curl.get());
  curl_easy_getinfo(curl.get(), CURLINFO_RESPONSE_CODE, &reply.code);
  curl_slist_free_all(headers);
  require(status == CURLE_OK,
          "Servidor LAN indisponível ou transferência interrompida");
  reply.data = std::move(output.body);
  return reply;
}
void replace_file(const fs::path &path, const std::string &value) {
  const auto temp = path.string() + ".new";
  if (fs::exists(fs::symlink_status(temp))) {
    require(fs::is_regular_file(fs::symlink_status(temp)),
            "Unsafe temporary file");
    fs::remove(temp);
  }
  write_config(temp, value);
  fs::rename(temp, path);
}
struct NativeGame {
  std::string id, title, system, format, cover;
  uint64_t size = 0;
};
struct Prepared {
  fs::path content, config, saves, core, manifest;
  std::string identity, game;
};
void remember_runtime(const Prepared &p, const fs::path &state,
                      unsigned frames) {
  auto doc = parse("{}");
  json_object_object_add(doc.get(), "game",
                         json_object_new_string(p.game.c_str()));
  json_object_object_add(doc.get(), "identity",
                         json_object_new_string(p.identity.c_str()));
  json_object_object_add(doc.get(), "content",
                         json_object_new_string(p.content.filename().c_str()));
  json_object_object_add(doc.get(), "testFrames", json_object_new_int(frames));
  json_object_object_add(
      doc.get(), "startedMs",
      json_object_new_int64(
          std::chrono::duration_cast<std::chrono::milliseconds>(
              std::chrono::steady_clock::now().time_since_epoch())
              .count()));
  replace_file(state / "pending.json", json_object_to_json_string_ext(
                                           doc.get(), JSON_C_TO_STRING_PLAIN));
}
Prepared pending_runtime(const fs::path &app, const fs::path &state,
                         const fs::path &cache, Json &doc) {
  doc = parse(read_file(state / "pending.json", 4096));
  Prepared p;
  p.game = string_field(doc.get(), "game");
  p.identity = string_field(doc.get(), "identity");
  require(
      std::regex_match(p.game, std::regex("(snes|ps1)-[0-9a-f]{64}")) &&
          std::regex_match(
              p.identity,
              std::regex("(snes9x|pcsx_rearmed)-[0-9a-f]{40}-[0-9a-f]{64}")),
      "Contexto de progresso inválido");
  auto name = string_field(doc.get(), "content");
  require(
      std::regex_match(
          name,
          std::regex(
              "snes-[0-9a-f]{64}\\.(sfc|smc)|file[0-9]{2}\\.(cue|chd|m3u)")),
      "Conteúdo de retorno inválido");
  p.content = cache / name;
  p.saves = state / "s" / p.identity.substr(p.identity.size() - 64) /
            p.game.substr(p.game.find('-') + 1);
  private_directory(p.saves);
  p.core = app / "cores" /
           (p.game.rfind("ps1-", 0) == 0 ? "pcsx_rearmed_libretro.so"
                                         : "snes9x_libretro.so");
  if (p.game.rfind("ps1-", 0) == 0)
    p.manifest = cache / "disc/manifest.json";
  return p;
}
void archive_userdata(const fs::path &state, const std::string &server,
                      const std::string &token) {
  auto doc = parse("{\"schema\":1,\"files\":[]}");
  auto *files = member(doc.get(), "files", json_type_array);
  size_t total = 0;
  for (const auto &entry : fs::recursive_directory_iterator(state)) {
    require(!fs::is_symlink(entry.symlink_status()),
            "Backup contém link; preserve os dados");
    if (!entry.is_regular_file() || entry.path().filename() == "session.json" ||
        fs::relative(entry.path(), state).string().rfind("config/pulse/", 0) ==
            0)
      continue;
    auto bytes = read_file(entry.path(), 16 * 1024 * 1024);
    total += bytes.size();
    require(total <= 20 * 1024 * 1024, "Backup excede limite");
    std::string encoded(4 * ((bytes.size() + 2) / 3) + 1, '\0');
    const auto n =
        EVP_EncodeBlock(reinterpret_cast<unsigned char *>(encoded.data()),
                        reinterpret_cast<const unsigned char *>(bytes.data()),
                        static_cast<int>(bytes.size()));
    encoded.resize(n);
    auto *item = json_object_new_object();
    json_object_object_add(
        item, "path",
        json_object_new_string(fs::relative(entry.path(), state).c_str()));
    json_object_object_add(item, "sha256",
                           json_object_new_string(sha256_bytes(bytes).c_str()));
    json_object_object_add(item, "data",
                           json_object_new_string(encoded.c_str()));
    json_object_array_add(files, item);
  }
  const std::string data =
      json_object_to_json_string_ext(doc.get(), JSON_C_TO_STRING_PLAIN);
  const auto digest = sha256_bytes(data);
  const auto response = native_api(
      server, token, "/api/native/archives/" + digest, data, "\"0\"");
  require(response.code == 200 && response.etag == "\"" + digest + "\"",
          "Não foi possível exportar backup; dados locais preservados");
  std::cout << "native-backup sha256=" << digest
            << " files=" << json_object_array_length(files) << std::endl;
}
void sync_progress(const Prepared &p, const std::string &server,
                   const std::string &token, bool before) {
  const auto tracking = p.saves / "sync.json";
  auto versions =
      fs::exists(tracking) ? parse(read_file(tracking, 65536)) : parse("{}");
  const auto base = "/api/native/saves/" + p.game + "/" + p.identity + "/";
  if (before) {
    const auto listing =
        native_api(server, token, base.substr(0, base.size() - 1));
    require(listing.code == 200, "Não foi possível verificar backups nativos");
    auto index = parse(listing.data);
    auto *remote_files = member(index.get(), "files", json_type_array);
    require(json_object_array_length(remote_files) <= 100,
            "Limite de backups excedido");
    for (size_t i = 0; i < json_object_array_length(remote_files); ++i) {
      const auto name =
          string_field(json_object_array_get_idx(remote_files, i), "name");
      require(std::regex_match(
                  name,
                  std::regex("[a-zA-Z0-9_.-]{1,150}\\.(srm|state[0-9]*|mcr)")),
              "Arquivo de progresso remoto inválido");
      const auto path = p.saves / name;
      auto reply = native_api(server, token, base + name);
      if (reply.code == 200) {
        require(reply.digest == sha256_bytes(reply.data),
                "Checksum do progresso remoto inválido");
        if (!fs::exists(path))
          replace_file(path, reply.data);
        else {
          const auto local = sha256(path);
          json_object *known = nullptr;
          bool tracked =
              json_object_object_get_ex(versions.get(), name.c_str(), &known);
          if (local != reply.digest &&
              (!tracked ||
               std::string(json_object_get_string(known)) != reply.etag))
            throw std::runtime_error("Conflito de progresso: cópia local "
                                     "preservada. Exporte antes de continuar.");
        }
        json_object_object_add(versions.get(), name.c_str(),
                               json_object_new_string(reply.etag.c_str()));
      } else
        require(reply.code == 404,
                "Não foi possível verificar progresso remoto");
    }
  } else {
    for (const auto &entry : fs::directory_iterator(p.saves)) {
      const auto name = entry.path().filename().string();
      if (!std::regex_match(
              name,
              std::regex("[a-zA-Z0-9_.-]{1,150}\\.(srm|state[0-9]*|mcr)")))
        continue;
      const auto data = read_file(entry.path(), 16 * 1024 * 1024);
      json_object *known = nullptr;
      const auto expected =
          json_object_object_get_ex(versions.get(), name.c_str(), &known)
              ? std::string(json_object_get_string(known))
              : "\"0\"";
      const auto reply = native_api(server, token, base + name, data, expected);
      require(
          reply.code == 200,
          "Backup LAN falhou ou houve conflito; progresso local preservado");
      require(reply.etag == "\"" + sha256_bytes(data) + "\"",
              "Backup LAN retornou checksum inválido");
      json_object_object_add(versions.get(), name.c_str(),
                             json_object_new_string(reply.etag.c_str()));
      replace_file(tracking, json_object_to_json_string_ext(
                                 versions.get(), JSON_C_TO_STRING_PLAIN));
    }
  }
  replace_file(tracking, json_object_to_json_string_ext(
                             versions.get(), JSON_C_TO_STRING_PLAIN));
}
Prepared prepare_native(const NativeGame &g, const fs::path &app,
                        const fs::path &state, const fs::path &cache,
                        const std::string &server, const std::string &token) {
  Prepared p;
  require(
      !fs::exists(state / "pending.json"),
      "Backup da sessão anterior pendente; use Y / R para tentar novamente");
  p.game = g.id;
  const auto core = g.system == "ps1" ? "pcsx_rearmed" : "snes9x";
  p.core = app / "cores" / (std::string(core) + "_libretro.so");
  p.identity =
      std::string(core) + "-" +
      (g.system == "ps1" ? "c8816799b50388e61cfe237fe2cdbb7d8175f20a"
                         : "fae2fea08f74180759ef540ee94259213f503480") +
      "-" + sha256(p.core);
  // PCSX retains 256-byte path buffers. Full binary/content hashes fit here;
  // the readable build identity stays in metadata and the server namespace.
  p.saves = state / "s" / sha256(p.core) / g.id.substr(g.id.find('-') + 1);
  private_directory(p.saves);
  const auto previous = state / p.identity / g.id;
  if (fs::is_directory(fs::symlink_status(previous))) {
    for (const auto &entry : fs::recursive_directory_iterator(previous)) {
      const auto name = entry.path().filename().string();
      if (fs::is_regular_file(entry.symlink_status()) &&
          std::regex_match(
              name,
              std::regex("[a-zA-Z0-9_.-]{1,150}\\.(srm|state[0-9]*|mcr)"))) {
        const auto target = p.saves / name;
        if (!fs::exists(fs::symlink_status(target)))
          replace_file(target, read_file(entry.path(), 16 * 1024 * 1024));
      }
    }
  }
  replace_file(p.saves / "identity.json",
               "{\"game\":\"" + g.id + "\",\"build\":\"" + p.identity + "\"}");
  private_directory(state / "system");
  private_directory(state / "config");
  if (g.system == "snes")
    p.content = prepare(server, g.id, cache);
  else {
    auto response =
        native_api(server, token, "/api/native/discs/" + g.id + "/manifest");
    require(response.code == 200, "Manifesto do disco indisponível");
    auto manifest = parse(response.data);
    require(string_field(manifest.get(), "id") == g.id,
            "Identidade do disco inválida");
    auto directory = cache / "disc";
    private_directory(directory);
    // Cores probe sidecars by basename; never reuse another disc's descriptor.
    for (const auto &entry : fs::directory_iterator(directory)) {
      const auto name = entry.path().filename().string();
      if (std::regex_match(
              name, std::regex("file[0-9]{2}\\.(cue|m3u|chd)|manifest\\.json|"
                               "disc-metrics\\.json|io-error\\.txt"))) {
        require(fs::is_regular_file(entry.symlink_status()),
                "Metadado de disco inseguro");
        fs::remove(entry.path());
      }
    }
    json_object_object_add(manifest.get(), "server",
                           json_object_new_string(server.c_str()));
    json_object_object_add(manifest.get(), "token",
                           json_object_new_string(token.c_str()));
    json_object_object_add(manifest.get(), "directory",
                           json_object_new_string(directory.c_str()));
    auto *texts = member(manifest.get(), "texts", json_type_object);
    json_object_object_foreach(texts, name, value) {
      require(std::regex_match(name, std::regex("file[0-9]{2}\\.(cue|m3u)")) &&
                  json_object_is_type(value, json_type_string),
              "Descritor inválido");
      const std::string text = json_object_get_string(value);
      require(text.size() < 65536, "Descritor muito grande");
      // Only mapped relative names can reach the core's descriptor parser.
      if (std::string(name).find(".cue") != std::string::npos) {
        std::istringstream lines(text);
        std::string line;
        while (std::getline(lines, line))
          if (line.find("FILE") != std::string::npos)
            require(
                std::regex_match(
                    line,
                    std::regex(
                        "FILE \"file[0-9]{2}\\.(bin|img|iso)\" BINARY\\s*")),
                "Referência CUE insegura");
      } else {
        std::istringstream lines(text);
        std::string line;
        while (std::getline(lines, line))
          require(
              std::regex_match(line, std::regex("file[0-9]{2}\\.(cue|chd)")),
              "Playlist insegura");
      }
      replace_file(directory / name, text);
    }
    const auto entry = string_field(manifest.get(), "entry");
    require(std::regex_match(entry, std::regex("file[0-9]{2}\\.(cue|m3u|chd)")),
            "Entrada de disco inválida");
    p.content = directory / entry;
    p.manifest = directory / "manifest.json";
    const auto io_error = directory / "io-error.txt";
    if (fs::exists(fs::symlink_status(io_error))) {
      require(fs::is_regular_file(fs::symlink_status(io_error)),
              "Unsafe I/O marker");
      fs::remove(io_error);
    }
    auto *remote_files = member(manifest.get(), "files", json_type_array);
    require(json_object_array_length(remote_files) <= 100,
            "Limite de arquivos de disco excedido");
    for (size_t i = 0; i < json_object_array_length(remote_files); ++i) {
      auto name =
          string_field(json_object_array_get_idx(remote_files, i), "name");
      require(std::regex_match(
                  name, std::regex("file[0-9]{2}\\.(bin|img|iso|chd|sub|sbi)")),
              "Nome de mídia inválido");
      if (fs::path(name).extension() == ".chd")
        replace_file(directory / name, "");
    }
    replace_file(p.manifest, json_object_to_json_string_ext(
                                 manifest.get(), JSON_C_TO_STRING_PLAIN));
    const auto bios = native_api(server, token, "/api/native/bios");
    require(bios.code == 200 && bios.data.size() == 512 * 1024 &&
                bios.digest == sha256_bytes(bios.data) &&
                std::regex_match(bios.bios,
                                 std::regex("scph(5501|7001|1001)\\.bin")),
            "BIOS PS1 ausente ou inválida no servidor");
    const auto firmware = state / "system" / bios.bios;
    if (!fs::is_regular_file(fs::symlink_status(firmware)) ||
        sha256(firmware) != bios.digest)
      replace_file(firmware, bios.data);
  }
  // Battery data is compatible across builds of this exact pinned core source.
  // States remain isolated by binary hash. Never choose between differing
  // saves.
  const auto battery = p.saves / (p.content.stem().string() + ".srm");
  if (!fs::exists(fs::symlink_status(battery))) {
    std::string candidate_bytes, candidate_hash;
    const auto source_prefix = p.identity.substr(0, p.identity.size() - 64);
    for (const auto &binary : fs::directory_iterator(state / "s")) {
      if (!fs::is_directory(binary.symlink_status()) ||
          !std::regex_match(binary.path().filename().string(),
                            std::regex("[0-9a-f]{64}")))
        continue;
      const auto other = binary.path() / g.id.substr(g.id.find('-') + 1);
      if (other == p.saves || !fs::is_directory(fs::symlink_status(other)))
        continue;
      const auto identity = other / "identity.json",
                 saved = other / battery.filename();
      if (!fs::is_regular_file(fs::symlink_status(identity)) ||
          !fs::is_regular_file(fs::symlink_status(saved)))
        continue;
      auto info = parse(read_file(identity, 4096));
      if (string_field(info.get(), "game") != g.id ||
          string_field(info.get(), "build").rfind(source_prefix, 0) != 0)
        continue;
      auto bytes = read_file(saved, 128 * 1024);
      require(
          !bytes.empty() && (g.system != "ps1" || (bytes.size() == 131072 &&
                                                   bytes.substr(0, 2) == "MC")),
          "Formato de progresso anterior não reconhecido; preserve o backup");
      const auto digest = sha256_bytes(bytes);
      require(candidate_hash.empty() || candidate_hash == digest,
              "Há versões diferentes do progresso anterior; preserve ambas "
              "antes de escolher");
      candidate_hash = digest;
      candidate_bytes = std::move(bytes);
    }
    if (!candidate_hash.empty())
      replace_file(battery, candidate_bytes);
  }
  auto config = read_file(app / "retroarch.cfg", 65536);
  config +=
      "\nsavefile_directory = " + quote(p.saves) +
      "\nsavestate_directory = " + quote(p.saves) +
      "\nsystem_directory = " + quote(state / "system") +
      "\nlibretro_directory = " + quote(app / "cores") +
      "\nmenu_show_quit_retroarch = \"true\"\nquit_press_twice = \"false\"\n";
  p.config = cache / "native.cfg";
  replace_file(p.config, config);
  sync_progress(p, server, token, true);
  return p;
}

class NativeUI {
  SDL_Window *window = nullptr;
  SDL_Renderer *renderer = nullptr;
  FT_Library ft = nullptr;
  FT_Face body = nullptr, display = nullptr;
  std::vector<SDL_GameController *> controllers;
  StickNavigation stick;
  struct Label {
    SDL_Texture *texture;
    int width, height;
  };
  std::map<std::string, Label> labels;
  const SDL_Color text{245, 241, 232, 255}, muted{173, 183, 204, 255},
      purple{168, 137, 247, 255}, yellow{249, 219, 109, 255};
  void rect(int x, int y, int w, int h, SDL_Color color) {
    SDL_SetRenderDrawColor(renderer, color.r, color.g, color.b, color.a);
    SDL_Rect box{x, y, w, h};
    SDL_RenderFillRect(renderer, &box);
  }
  Label label(const std::string &value, int size, bool pixel = false) {
    auto key = value + "#" + std::to_string(size) + (pixel ? "p" : "b");
    auto found = labels.find(key);
    if (found != labels.end())
      return found->second;
    auto face = pixel ? display : body;
    FT_Set_Pixel_Sizes(face, 0, size);
    std::vector<uint32_t> chars;
    const auto *p = reinterpret_cast<const unsigned char *>(value.c_str());
    while (*p) {
      uint32_t c = *p++;
      if (c >= 0xC0) {
        unsigned n = c < 0xE0 ? 1 : c < 0xF0 ? 2 : 3;
        c &= (1u << (6 - n)) - 1;
        while (n-- && *p)
          c = (c << 6) | (*p++ & 63);
      }
      chars.push_back(c);
    }
    int width = 1;
    for (auto c : chars)
      if (!FT_Load_Char(face, c, FT_LOAD_RENDER))
        width += face->glyph->advance.x >> 6;
    int height = size * 2;
    auto *surface = SDL_CreateRGBSurfaceWithFormat(0, width, height, 32,
                                                   SDL_PIXELFORMAT_RGBA32);
    require(surface, "Falha de texto");
    SDL_FillRect(surface, nullptr, 0);
    int x = 0;
    for (auto c : chars) {
      if (FT_Load_Char(face, c, FT_LOAD_RENDER))
        continue;
      auto *g = face->glyph;
      int y = size - g->bitmap_top;
      for (unsigned row = 0; row < g->bitmap.rows; ++row)
        for (unsigned col = 0; col < g->bitmap.width; ++col) {
          int dx = x + g->bitmap_left + static_cast<int>(col),
              dy = y + static_cast<int>(row);
          if (dx >= 0 && dx < width && dy >= 0 && dy < height) {
            auto *out = static_cast<unsigned char *>(surface->pixels) +
                        dy * surface->pitch + dx * 4;
            out[0] = 255;
            out[1] = 255;
            out[2] = 255;
            out[3] = g->bitmap.buffer[row * g->bitmap.pitch + col];
          }
        }
      x += g->advance.x >> 6;
    }
    Label result{SDL_CreateTextureFromSurface(renderer, surface), width,
                 height};
    SDL_FreeSurface(surface);
    require(result.texture, "Falha de textura de texto");
    SDL_SetTextureBlendMode(result.texture, SDL_BLENDMODE_BLEND);
    if (labels.size() > 350) {
      for (auto &item : labels)
        SDL_DestroyTexture(item.second.texture);
      labels.clear();
    }
    labels[key] = result;
    return result;
  }
  void print(const std::string &value, int x, int y, int size, SDL_Color color,
             int max = 1800, bool pixel = false) {
    auto l = label(value, size, pixel);
    SDL_SetTextureColorMod(l.texture, color.r, color.g, color.b);
    SDL_Rect dst{x, y, l.width, l.height};
    SDL_Rect clip{x, y, max, 1080 - y};
    SDL_RenderSetClipRect(renderer, &clip);
    SDL_RenderCopy(renderer, l.texture, nullptr, &dst);
    SDL_RenderSetClipRect(renderer, nullptr);
  }

public:
  explicit NativeUI(const fs::path &app) {
    require(SDL_InitSubSystem(SDL_INIT_GAMECONTROLLER) == 0, SDL_GetError());
    window =
        SDL_CreateWindow("Super Flip CB", SDL_WINDOWPOS_UNDEFINED,
                         SDL_WINDOWPOS_UNDEFINED, 1920, 1080,
                         std::string(SDL_GetCurrentVideoDriver()) == "dummy"
                             ? 0
                             : SDL_WINDOW_FULLSCREEN_DESKTOP);
    require(window, SDL_GetError());
    renderer = SDL_CreateRenderer(
        window, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
    if (!renderer && std::string(SDL_GetCurrentVideoDriver()) == "dummy")
      renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_SOFTWARE);
    require(renderer, SDL_GetError());
    SDL_RenderSetLogicalSize(renderer, 1920, 1080);
    require(FT_Init_FreeType(&ft) == 0 &&
                FT_New_Face(ft, (app / "assets/Archivo.ttf").c_str(), 0,
                            &body) == 0 &&
                FT_New_Face(ft, (app / "assets/Pixelify.ttf").c_str(), 0,
                            &display) == 0,
            "Fontes nativas indisponíveis");
    for (int i = 0; i < SDL_NumJoysticks(); ++i)
      if (SDL_IsGameController(i))
        controllers.push_back(SDL_GameControllerOpen(i));
  }
  ~NativeUI() {
    for (auto &item : labels)
      SDL_DestroyTexture(item.second.texture);
    if (body)
      FT_Done_Face(body);
    if (display)
      FT_Done_Face(display);
    if (ft)
      FT_Done_FreeType(ft);
    for (auto *controller : controllers)
      if (controller)
        SDL_GameControllerClose(controller);
    if (renderer)
      SDL_DestroyRenderer(renderer);
    if (window)
      SDL_DestroyWindow(window);
    // Keep the video device (without windows/contexts) for webOS lifecycle
    // callbacks; its relaunch callback dereferences SDL_GetVideoDevice().
    SDL_QuitSubSystem(SDL_INIT_GAMECONTROLLER);
  }
  int input() {
    SDL_Event e;
    int command = 0;
    while (SDL_PollEvent(&e)) {
      if (e.type == SDL_QUIT)
        return 9;
      if (e.type == SDL_CONTROLLERDEVICEADDED &&
          SDL_IsGameController(e.cdevice.which))
        controllers.push_back(SDL_GameControllerOpen(e.cdevice.which));
      if (e.type == SDL_CONTROLLERDEVICEREMOVED) {
        controllers.erase(
            std::remove_if(controllers.begin(), controllers.end(),
                           [](auto *pad) {
                             if (pad && SDL_GameControllerGetAttached(pad))
                               return false;
                             if (pad)
                               SDL_GameControllerClose(pad);
                             return true;
                           }),
            controllers.end());
        stick = {};
      }
      if (e.type == SDL_CONTROLLERBUTTONDOWN) {
        switch (e.cbutton.button) {
        case SDL_CONTROLLER_BUTTON_DPAD_LEFT:
          command = 1;
          break;
        case SDL_CONTROLLER_BUTTON_DPAD_RIGHT:
          command = 2;
          break;
        case SDL_CONTROLLER_BUTTON_DPAD_UP:
          command = 3;
          break;
        case SDL_CONTROLLER_BUTTON_DPAD_DOWN:
          command = 4;
          break;
        case SDL_CONTROLLER_BUTTON_A:
          command = 5;
          break;
        case SDL_CONTROLLER_BUTTON_B:
          command = 6;
          break;
        case SDL_CONTROLLER_BUTTON_LEFTSHOULDER:
          command = 7;
          break;
        case SDL_CONTROLLER_BUTTON_RIGHTSHOULDER:
          command = 8;
          break;
        case SDL_CONTROLLER_BUTTON_Y:
          command = 10;
          break;
        }
      }
      if (e.type == SDL_KEYDOWN && !e.key.repeat) {
        switch (e.key.keysym.sym) {
        case SDLK_LEFT:
          command = 1;
          break;
        case SDLK_RIGHT:
          command = 2;
          break;
        case SDLK_UP:
          command = 3;
          break;
        case SDLK_DOWN:
          command = 4;
          break;
        case SDLK_RETURN:
        case SDLK_KP_ENTER:
          command = 5;
          break;
        case SDLK_ESCAPE:
        case SDLK_BACKSPACE:
        case SDLK_AC_BACK:
          command = 6;
          break;
        case SDLK_PAGEUP:
          command = 7;
          break;
        case SDLK_PAGEDOWN:
          command = 8;
          break;
        case SDLK_r:
          command = 10;
          break;
        }
      }
    }
    int x = 0, y = 0;
    for (auto *pad : controllers) {
      if (!pad || !SDL_GameControllerGetAttached(pad))
        continue;
      const int px = SDL_GameControllerGetAxis(pad, SDL_CONTROLLER_AXIS_LEFTX);
      const int py = SDL_GameControllerGetAxis(pad, SDL_CONTROLLER_AXIS_LEFTY);
      if (std::max(std::abs(px), std::abs(py)) >
          std::max(std::abs(x), std::abs(y))) {
        x = px;
        y = py;
      }
    }
    const int analog = stick.sample(x, y, SDL_GetTicks64());
    return command ? command : analog;
  }
  void capture(const fs::path &path) {
    auto *surface = SDL_CreateRGBSurfaceWithFormat(0, 1920, 1080, 32,
                                                   SDL_PIXELFORMAT_RGBA32);
    require(surface &&
                SDL_RenderReadPixels(renderer, nullptr, SDL_PIXELFORMAT_RGBA32,
                                     surface->pixels, surface->pitch) == 0,
            "UI capture failed");
    const int result = SDL_SaveBMP(surface, path.c_str());
    SDL_FreeSurface(surface);
    require(result == 0, "UI capture write failed");
    SDL_RenderPresent(renderer);
  }
  void draw(const std::vector<NativeGame> &games, int system, size_t selected,
            bool detail, const std::string &status, bool busy,
            bool tabs = false, bool present = true) {
    rect(0, 0, 1920, 1080, {16, 19, 33, 255});
    print("SUPER FLIP CB", 72, 34, 52, purple, 850, true);
    print("SUA BIBLIOTECA · NA TV", 1260, 60, 24, muted);
    rect(72, 137, 1776, 2, {52, 59, 86, 255});
    print("Biblioteca", 72, 162, 44, text);
    print("Escolha um jogo. O próximo mundo está aqui.", 72, 220, 26, muted);
    for (int i = 0; i < 2; ++i) {
      if (tabs && system == i)
        rect(68 + i * 340, 282, 324, 72, yellow);
      rect(72 + i * 340, 286, 316, 64,
           system == i ? purple : SDL_Color{27, 32, 52, 255});
      print(i == 0 ? "SUPER NINTENDO" : "PLAYSTATION", 94 + i * 340, 296, 25,
            system == i ? SDL_Color{16, 19, 33, 255} : text);
    }
    print(std::to_string(games.size()) + " jogos", 1630, 302, 25, muted);
    if (games.empty())
      print(busy ? "Conectando ao servidor…"
                 : "Nenhum jogo disponível neste sistema.",
            72, 420, 34, text);
    size_t page = selected / 12;
    for (size_t slot = 0; slot < 12 && page * 12 + slot < games.size();
         ++slot) {
      const auto index = page * 12 + slot;
      const auto &g = games[index];
      int x = 72 + static_cast<int>(slot % 4) * 450,
          y = 388 + static_cast<int>(slot / 4) * 168;
      if (index == selected && !tabs)
        rect(x - 4, y - 4, 430, 148, yellow);
      rect(x, y, 422, 140, {27, 32, 52, 255});
      rect(x + 20, y + 20, 4, 96, purple);
      print(g.title, x + 42, y + 20, 26, text, 358);
      print(g.system == "ps1" ? "PlayStation" : "Super Nintendo", x + 42,
            y + 85, 21, muted, 358);
    }
    if (!games.empty())
      print("Página " + std::to_string(page + 1) + " / " +
                std::to_string((games.size() + 11) / 12),
            72, 914, 22, muted);
    print(status, 72, 964, 24, muted, 1760);
    print("D-pad  Navegar     A / OK  Abrir     B / Voltar  Fechar     LB / RB "
          " Sistema     Y / R  Atualizar",
          72, 1022, 22, muted);
    if (detail && !games.empty()) {
      rect(270, 265, 1380, 575, {8, 10, 18, 255});
      rect(274, 269, 1372, 567, {27, 32, 52, 255});
      print(games[selected].system == "ps1" ? "PLAYSTATION" : "SUPER NINTENDO",
            330, 307, 25, purple);
      print(games[selected].title, 330, 370, 46, text, 1240);
      print(games[selected].system == "ps1"
                ? "Disco lido sob demanda · cache de 16 MiB"
                : "Snes9x nativo · ROM verificada",
            330, 466, 28, muted);
      print("Select + Start abre o menu durante o jogo.", 330, 524, 28, muted);
      print("No menu, Sair do RetroArch retorna à biblioteca.", 330, 570, 28,
            muted);
      rect(330, 672, 490, 80, yellow);
      print(busy ? "Preparando…" : "A / OK   JOGAR", 356, 686, 31,
            {16, 19, 33, 255});
      print("B / Voltar   Biblioteca", 950, 701, 25, text);
    }
    if (present)
      SDL_RenderPresent(renderer);
  }
};

int native_frontend(const fs::path &app, const fs::path &state,
                    const fs::path &cache, const fs::path &session) {
  auto settings = parse(read_file(session, 4096));
  const auto server = server_origin(string_field(settings.get(), "server"));
  const auto token = string_field(settings.get(), "token");
  require(std::regex_match(token, std::regex("[0-9a-f]{64}")),
          "Pareamento nativo inválido");
  require(::setenv("SDL_APP_ID", "com.superflipcb.native", 1) == 0,
          "SDL app id failed");
  private_directory(state);
  private_directory(cache);
  recover_orphan_runtime(app);
  json_object *maintenance = nullptr;
  if (std::getenv("SFCB_BACKUP_ONLY") ||
      (json_object_object_get_ex(settings.get(), "backupOnly", &maintenance) &&
       json_object_get_boolean(maintenance))) {
    archive_userdata(state, server, token);
    return 0;
  }
  if (session != state / "session.json") {
    replace_file(state / "session.json", read_file(session, 4096));
    fs::remove(session);
  }
  int lock = -1;
  if (const char *inherited = std::getenv("SFCB_LOCK_FD")) {
    if (std::regex_match(inherited, std::regex("[0-9]{1,6}"))) {
      int fd = std::stoi(inherited);
      struct stat descriptor {
      }, file{};
      if (fd > 2 && ::fstat(fd, &descriptor) == 0 &&
          ::stat((cache / "session.lock").c_str(), &file) == 0 &&
          descriptor.st_dev == file.st_dev &&
          descriptor.st_ino == file.st_ino && descriptor.st_uid == ::geteuid())
        lock = fd;
    }
  }
  if (lock < 0)
    lock = ::open((cache / "session.lock").c_str(),
                  O_CREAT | O_RDWR | O_NOFOLLOW, 0600);
  require(lock >= 0 && ::flock(lock, LOCK_EX | LOCK_NB) == 0,
          "Outra sessão nativa está aberta");
  ::setenv("SFCB_LOCK_FD", std::to_string(lock).c_str(), 1);
  SDLSession sdl;
  std::vector<NativeGame> all;
  int system = 0;
  size_t selected = 0;
  bool detail = false, tabs = false;
  std::string status;
  std::future<std::vector<NativeGame>> catalog_task;
  std::future<Prepared> preparation;
  std::future<std::string> sync_task;
  bool capture_return = false;
  std::string last_game;
  std::string start_game;
  unsigned test_frames = 0;
  if (const char *id = std::getenv("SFCB_START_GAME"))
    start_game = id;
  if (const char *frames = std::getenv("SFCB_TEST_FRAMES"))
    test_frames = static_cast<unsigned>(std::stoul(frames));
  auto resume = [&] {
    if (!fs::is_regular_file(fs::symlink_status(state / "pending.json")))
      return;
    Json pending(nullptr, json_object_put);
    auto p = pending_runtime(app, state, cache, pending);
    last_game = p.game;
    system = p.game.rfind("ps1-", 0) == 0 ? 1 : 0;
    auto frames =
        json_object_get_int(member(pending.get(), "testFrames", json_type_int));
    capture_return = frames > 0;
    auto report = parse("{}");
    json_object_object_add(report.get(), "game",
                           json_object_new_string(p.game.c_str()));
    json_object_object_add(report.get(), "coreBuild",
                           json_object_new_string(p.identity.c_str()));
    json_object_object_add(report.get(), "testFrameLimit",
                           json_object_new_int(frames));
    if (const char *result = std::getenv("SFCB_RUNTIME_RESULT")) {
      require(std::regex_match(result, std::regex("[0-9]{1,3}")),
              "Invalid runtime result");
      json_object_object_add(report.get(), "exitStatus",
                             json_object_new_int(std::stoi(result)));
      const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                           std::chrono::steady_clock::now().time_since_epoch())
                           .count();
      const auto started = json_object_get_int64(
          member(pending.get(), "startedMs", json_type_int));
      json_object_object_add(
          report.get(), "runtimeWallMs",
          now >= started ? json_object_new_int64(now - started) : nullptr);
    } else
      json_object_object_add(report.get(), "exitStatus", nullptr);
    replace_file(state / "run.json", json_object_to_json_string_ext(
                                         report.get(), JSON_C_TO_STRING_PLAIN));
    if (!p.manifest.empty() &&
        fs::is_regular_file(p.manifest.parent_path() / "disc-metrics.json")) {
      auto metrics = parse(
          read_file(p.manifest.parent_path() / "disc-metrics.json", 65536));
      json_object_object_add(metrics.get(), "game",
                             json_object_new_string(p.game.c_str()));
      replace_file(state / "disc-metrics.json",
                   json_object_to_json_string_ext(metrics.get(),
                                                  JSON_C_TO_STRING_PLAIN));
    }
    sync_task = std::async(std::launch::async, [&, p] {
      sync_progress(p, server, token, false);
      archive_userdata(state, server, token);
      fs::remove(state / "pending.json");
      if (!p.manifest.empty() &&
          fs::is_regular_file(p.manifest.parent_path() / "io-error.txt"))
        return read_file(p.manifest.parent_path() / "io-error.txt", 4096);
      return std::string("Progresso local preservado. Backup LAN concluído.");
    });
  };
  auto reload = [&] {
    status = "Conectando ao servidor LAN…";
    catalog_task = std::async(std::launch::async, [&] {
      auto reply = native_api(server, token, "/api/native/catalog");
      require(reply.code == 200,
              "Servidor indisponível ou pareamento inválido");
      auto doc = parse(reply.data);
      auto *items = member(doc.get(), "items", json_type_array);
      require(json_object_array_length(items) <= 10000,
              "Catálogo excede limite");
      std::vector<NativeGame> result;
      for (size_t i = 0; i < json_object_array_length(items); ++i) {
        auto *item = json_object_array_get_idx(items, i);
        NativeGame g;
        g.id = string_field(item, "id");
        g.title = string_field(item, "title");
        g.system = string_field(item, "system");
        require(std::regex_match(g.id, std::regex("(snes|ps1)-[0-9a-f]{64}")) &&
                    (g.system == "snes" || g.system == "ps1") &&
                    g.title.size() < 512,
                "Entrada de catálogo inválida");
        auto *media = member(item, "media", json_type_object);
        g.format = string_field(media, "format");
        result.push_back(g);
      }
      return result;
    });
  };
  reload();
  resume();
  auto ui = std::make_unique<NativeUI>(app);
  while (true) {
    if (quit_requested)
      break;
    bool busy =
        catalog_task.valid() || preparation.valid() || sync_task.valid();
    if (sync_task.valid() && sync_task.wait_for(std::chrono::seconds(0)) ==
                                 std::future_status::ready) {
      try {
        status = sync_task.get();
      } catch (const std::exception &e) {
        status = e.what();
      }
    }
    if (catalog_task.valid() && catalog_task.wait_for(std::chrono::seconds(
                                    0)) == std::future_status::ready) {
      try {
        all = catalog_task.get();
        selected = 0;
        status = "Biblioteca conectada";
      } catch (const std::exception &e) {
        status = e.what();
      }
    }
    if (preparation.valid() && preparation.wait_for(std::chrono::seconds(0)) ==
                                   std::future_status::ready) {
      try {
        auto p = preparation.get();
        remember_runtime(p, state, test_frames);
        ::setenv("XDG_CONFIG_HOME", (state / "config").c_str(), 1);
        ::setenv("SFCB_UI_EXEC", (app / "superflip-native").c_str(), 1);
        ::setenv("SFCB_STATE_DIR", state.c_str(), 1);
        ::setenv("SFCB_CACHE_DIR", cache.c_str(), 1);
        ::setenv("SFCB_RUNTIME_ACTIVE", "1", 1);
        ::setenv("SDL_WEBOS_REGISTER_APP", "1", 1);
        ::unsetenv("SFCB_START_GAME");
        ::unsetenv("SFCB_TEST_FRAMES");
        ::unsetenv("SFCB_RUNTIME_RESULT");
        if (!p.manifest.empty())
          ::setenv("SFCB_DISC_MANIFEST", p.manifest.c_str(), 1);
        else
          ::unsetenv("SFCB_DISC_MANIFEST");
        std::vector<std::string> args{(app / "retroarch").string(),
                                      "--verbose",
                                      "--log-file",
                                      (state / "retroarch.log").string(),
                                      "--config",
                                      p.config.string(),
                                      "-L",
                                      p.core.string(),
                                      p.content.string()};
        if (test_frames)
          args.insert(args.end(), {"--max-frames", std::to_string(test_frames),
                                   "--max-frames-ss", "--max-frames-ss-path",
                                   (state / "smoke.png").string()});
        std::vector<char *> pointers;
        for (auto &arg : args)
          pointers.push_back(arg.data());
        pointers.push_back(nullptr);
        ui.reset();
        SDL_Quit();
        curl_global_cleanup();
        ::execv(pointers[0], pointers.data());
        std::cerr << "Cannot execute RetroArch; progress preserved: "
                  << std::strerror(errno) << std::endl;
        return 1;
      } catch (const std::exception &e) {
        status = e.what();
        if (!ui)
          ui = std::make_unique<NativeUI>(app);
      }
    }
    std::vector<NativeGame> games;
    for (const auto &g : all)
      if (g.system == (system == 0 ? "snes" : "ps1"))
        games.push_back(g);
    if (selected >= games.size())
      selected = games.empty() ? 0 : games.size() - 1;
    if (!last_game.empty() && !catalog_task.valid()) {
      auto found =
          std::find_if(games.begin(), games.end(),
                       [&](const auto &game) { return game.id == last_game; });
      if (found != games.end())
        selected = static_cast<size_t>(found - games.begin());
      last_game.clear();
    }
    if (capture_return && !catalog_task.valid() && !sync_task.valid()) {
      ui->draw(games, system, selected, false, status, false, tabs, false);
      ui->capture(state / "returned-ui.bmp");
      capture_return = false;
      sync_task = std::async(std::launch::async, [&] {
        archive_userdata(state, server, token);
        return std::string("Backup LAN concluído.");
      });
    }
    if (!busy && !start_game.empty()) {
      auto chosen = std::find_if(all.begin(), all.end(), [&](const auto &g) {
        return g.id == start_game;
      });
      if (chosen == all.end())
        status = "Jogo solicitado não está no catálogo";
      else {
        const auto game = *chosen;
        preparation = std::async(std::launch::async, [&, game] {
          return prepare_native(game, app, state, cache, server, token);
        });
      }
      start_game.clear();
    }
    auto input = ui->input();
    if (input == 9)
      break;
    if (!busy) {
      if (input == 6) {
        if (detail)
          detail = false;
        else
          break;
      } else if (input == 7 || input == 8) {
        system = 1 - system;
        selected = 0;
        detail = false;
      } else if (input == 10) {
        reload();
        resume();
      } else if (tabs) {
        if (input == 1 || input == 2) {
          system = 1 - system;
          selected = 0;
        }
        if (input == 4 || input == 5)
          tabs = false;
      } else if (!detail && !games.empty()) {
        if (input == 1 && selected > 0)
          --selected;
        if (input == 2 && selected + 1 < games.size())
          ++selected;
        if (input == 3 && selected >= 4)
          selected -= 4;
        else if (input == 3)
          tabs = true;
        if (input == 4 && selected + 4 < games.size())
          selected += 4;
        if (input == 5)
          detail = true;
      } else if (detail && input == 5 && !games.empty()) {
        const auto game = games[selected];
        status = "Verificando mídia e progresso…";
        preparation = std::async(std::launch::async, [&, game] {
          return prepare_native(game, app, state, cache, server, token);
        });
      }
    }
    ui->draw(games, system, selected, detail, status, busy, tabs);
    SDL_Delay(12);
    if (!catalog_task.valid() && !preparation.valid() && !sync_task.valid() &&
        start_game.empty())
      if (const char *capture = std::getenv("SFCB_UI_CAPTURE")) {
        ui->draw(games, system, selected, detail, status, busy, tabs, false);
        ui->capture(capture);
        return 0;
      }
  }
  return 0;
}
} // namespace
