// Read-only libretro VFS decorator. The original VFS owns every local
// operation.
#include "../third_party/libretro.h"
#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <curl/curl.h>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <json-c/json.h>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <openssl/sha.h>
#include <regex>
#include <signal.h>
#include <stdexcept>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

namespace {
constexpr size_t block_size = 128 * 1024, cache_limit = 16 * 1024 * 1024;
using Clock = std::chrono::steady_clock;
std::string hash(const void *data, size_t size) {
  unsigned char digest[32];
  SHA256(static_cast<const unsigned char *>(data), size, digest);
  const char *digits = "0123456789abcdef";
  std::string out;
  for (unsigned char c : digest) {
    out += digits[c >> 4];
    out += digits[c & 15];
  }
  return out;
}
std::string field(json_object *j, const char *key) {
  json_object *value = nullptr;
  if (!json_object_object_get_ex(j, key, &value) ||
      !json_object_is_type(value, json_type_string))
    throw std::runtime_error("Invalid disc manifest field");
  return json_object_get_string(value);
}
struct File {
  std::string path, url, etag;
  uint64_t size;
  std::vector<std::string> hashes;
};
struct Block {
  std::vector<char> data;
  bool ready = false;
  bool required = false;
  std::string error;
  uint64_t used = 0;
};
struct Job {
  std::shared_ptr<File> file;
  uint64_t index;
  std::shared_ptr<Block> block;
  bool prefetch;
};
struct Response {
  std::vector<char> body;
  std::string range, etag;
};
size_t body_cb(char *data, size_t size, size_t n, void *user) {
  auto &r = *static_cast<Response *>(user);
  const size_t bytes = size * n;
  if (bytes > block_size - r.body.size())
    return 0;
  r.body.insert(r.body.end(), data, data + bytes);
  return bytes;
}
size_t header_cb(char *data, size_t size, size_t n, void *user) {
  auto &r = *static_cast<Response *>(user);
  std::string line(data, size * n);
  auto split = line.find(':');
  if (split != std::string::npos) {
    auto key = line.substr(0, split);
    std::transform(key.begin(), key.end(), key.begin(), ::tolower);
    auto value = line.substr(split + 1);
    auto start = value.find_first_not_of(" \t");
    auto end = value.find_last_not_of("\r\n \t");
    if (start != std::string::npos && end != std::string::npos)
      value = value.substr(start, end - start + 1);
    if (key == "content-range")
      r.range = value;
    if (key == "etag")
      r.etag = value;
  }
  return size * n;
}
class Reader {
  std::mutex mutex;
  std::condition_variable wake;
  bool stopping = false;
  std::deque<Job> jobs;
  std::map<std::string, std::shared_ptr<Block>> blocks;
  std::thread worker;
  std::string token, origin, directory;
  uint64_t tick = 0;
  uint64_t hits = 0, misses = 0, requests = 0, bytes = 0, peak = 0,
           critical_us = 0;
  std::string fatal;
  static std::string key(const File &f, uint64_t i) {
    return f.path + ":" + std::to_string(i);
  }
  void fetch(CURL *curl, const Job &job) {
    const auto &f = *job.file;
    uint64_t start = job.index * block_size;
    uint64_t end = std::min(f.size, start + block_size) - 1;
    Response r;
    r.body.reserve(block_size);
    curl_easy_reset(curl);
    auto range = std::to_string(start) + "-" + std::to_string(end);
    curl_slist *headers = nullptr;
    headers = curl_slist_append(headers, ("X-Native-Token: " + token).c_str());
    headers = curl_slist_append(headers, ("If-Match: " + f.etag).c_str());
    curl_easy_setopt(curl, CURLOPT_URL, (origin + f.url).c_str());
    curl_easy_setopt(curl, CURLOPT_RANGE, range.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "http");
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(curl, CURLOPT_PROXY, "");
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 1500L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, 4000L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, body_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &r);
    curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, header_cb);
    curl_easy_setopt(curl, CURLOPT_HEADERDATA, &r);
    auto status = curl_easy_perform(curl);
    long code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
    curl_slist_free_all(headers);
    const auto expected = "bytes " + std::to_string(start) + "-" +
                          std::to_string(end) + "/" + std::to_string(f.size);
    if (status != CURLE_OK || code != 206 || r.range != expected ||
        r.etag != f.etag || r.body.size() != end - start + 1 ||
        hash(r.body.data(), r.body.size()) != f.hashes.at(job.index))
      throw std::runtime_error(
          "Falha de leitura LAN: resposta Range/versão/checksum inválida. "
          "Reabra o jogo.");
    job.block->data = std::move(r.body);
  }
  void loop() {
    CURL *curl = curl_easy_init();
    for (;;) {
      std::unique_lock<std::mutex> guard(mutex);
      wake.wait(guard, [&] { return stopping || !jobs.empty(); });
      if (stopping)
        break;
      Job job = jobs.front();
      jobs.pop_front();
      guard.unlock();
      std::string error;
      try {
        if (!curl)
          throw std::runtime_error("HTTP initialization failed");
        fetch(curl, job);
      } catch (const std::exception &e) {
        error = e.what();
      }
      guard.lock();
      ++requests;
      if (error.empty())
        bytes += job.block->data.size();
      else {
        job.block->error = error;
        if (job.block->required) {
          const bool first = fatal.empty();
          fatal = error;
          std::ofstream(directory + "/io-error.txt") << error;
          if (first && std::getenv("SFCB_RUNTIME_ACTIVE"))
            ::kill(::getpid(), SIGUSR1);
        } else
          blocks.erase(key(*job.file, job.index));
      }
      job.block->ready = true;
      wake.notify_all();
      metrics();
    }
    if (curl)
      curl_easy_cleanup(curl);
  }
  void metrics() {
    std::ofstream out(directory + "/disc-metrics.json");
    out << "{\"cacheHits\":" << hits << ",\"cacheMisses\":" << misses
        << ",\"requests\":" << requests << ",\"downloadBytes\":" << bytes
        << ",\"cachePeakBytes\":" << peak
        << ",\"cacheLimitBytes\":" << cache_limit
        << ",\"inFlightLimitBytes\":" << block_size
        << ",\"criticalWaitUs\":" << critical_us
        << ",\"ioFailed\":" << (!fatal.empty() ? "true" : "false") << "}\n";
  }
  std::shared_ptr<Block> enqueue(const std::shared_ptr<File> &file,
                                 uint64_t index, bool prefetch) {
    auto name = key(*file, index);
    auto found = blocks.find(name);
    if (found != blocks.end()) {
      found->second->used = ++tick;
      if (!prefetch) {
        found->second->required = true;
        ++hits;
        for (auto i = jobs.begin(); i != jobs.end(); ++i)
          if (i->block == found->second) {
            Job promoted = *i;
            jobs.erase(i);
            promoted.prefetch = false;
            jobs.push_front(promoted);
            break;
          }
      }
      return found->second;
    }
    while (blocks.size() >= cache_limit / block_size) {
      auto oldest = blocks.end();
      for (auto i = blocks.begin(); i != blocks.end(); ++i)
        if (i->second->ready && i->second.use_count() == 1 &&
            (oldest == blocks.end() || i->second->used < oldest->second->used))
          oldest = i;
      if (oldest == blocks.end())
        return {};
      blocks.erase(oldest);
    }
    auto block = std::make_shared<Block>();
    block->required = !prefetch;
    block->used = ++tick;
    blocks[name] = block;
    peak = std::max(peak, static_cast<uint64_t>(blocks.size() * block_size));
    Job job{file, index, block, prefetch};
    if (prefetch)
      jobs.push_back(job);
    else {
      ++misses;
      jobs.push_front(job);
    }
    wake.notify_all();
    return block;
  }

public:
  std::map<std::string, std::shared_ptr<File>> files;
  Reader(const std::string &manifest_path) {
    std::ifstream in(manifest_path);
    std::string text((std::istreambuf_iterator<char>(in)), {});
    if (text.size() > 4 * 1024 * 1024)
      throw std::runtime_error("Manifest exceeds limit");
    std::unique_ptr<json_object, decltype(&json_object_put)> root(
        json_tokener_parse(text.c_str()), json_object_put);
    if (!root)
      throw std::runtime_error("Invalid disc manifest");
    origin = field(root.get(), "server");
    token = field(root.get(), "token");
    directory = field(root.get(), "directory");
    if (!std::regex_match(
            origin,
            std::regex(
                R"(^http://(10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+|127\.[0-9.]+):[0-9]+$)")) ||
        !std::regex_match(token, std::regex("[0-9a-f]{64}")))
      throw std::runtime_error("Invalid LAN origin/token");
    json_object *entries = json_object_object_get(root.get(), "files");
    if (!entries || !json_object_is_type(entries, json_type_array) ||
        json_object_array_length(entries) > 100)
      throw std::runtime_error("Invalid files");
    for (size_t i = 0; i < json_object_array_length(entries); ++i) {
      auto *entry = json_object_array_get_idx(entries, i);
      auto f = std::make_shared<File>();
      auto name = field(entry, "name");
      auto digest = field(entry, "sha256");
      f->url = field(entry, "url");
      if (!std::regex_match(
              name, std::regex("file[0-9]{2}\\.(bin|img|iso|chd|sub|sbi)")) ||
          !std::regex_match(digest, std::regex("[0-9a-f]{64}")) ||
          !std::regex_match(
              f->url,
              std::regex("/api/native/discs/ps1-[0-9a-f]{64}/files/" + name)))
        throw std::runtime_error("Unsafe file mapping");
      f->path = directory + "/" + name;
      f->etag = "\"" + digest + "\"";
      f->size = json_object_get_uint64(json_object_object_get(entry, "size"));
      if (!f->size || f->size > uint64_t(2) * 1024 * 1024 * 1024)
        throw std::runtime_error("Invalid disc file size");
      auto *hashes = json_object_object_get(entry, "blocks");
      if (!hashes || json_object_array_length(hashes) !=
                         (f->size + block_size - 1) / block_size)
        throw std::runtime_error("Invalid block map");
      for (size_t j = 0; j < json_object_array_length(hashes); ++j) {
        const char *h =
            json_object_get_string(json_object_array_get_idx(hashes, j));
        if (!h || !std::regex_match(h, std::regex("[0-9a-f]{64}")))
          throw std::runtime_error("Invalid block hash");
        f->hashes.emplace_back(h);
      }
      files[f->path] = f;
    }
    worker = std::thread(&Reader::loop, this);
  }
  ~Reader() {
    {
      std::lock_guard<std::mutex> guard(mutex);
      stopping = true;
      wake.notify_all();
    }
    if (worker.joinable())
      worker.join();
    metrics();
  }
  int64_t read(const std::shared_ptr<File> &f, uint64_t &position, void *output,
               uint64_t length) {
    std::unique_lock<std::mutex> guard(mutex);
    if (!fatal.empty())
      return -1;
    if (position >= f->size)
      return 0;
    length = std::min(length, f->size - position);
    uint64_t copied = 0;
    while (copied < length) {
      const auto index = position / block_size;
      auto block = enqueue(f, index, false);
      if (!block)
        return -1;
      const auto begin = Clock::now();
      wake.wait(guard, [&] { return block->ready || stopping; });
      critical_us += std::chrono::duration_cast<std::chrono::microseconds>(
                         Clock::now() - begin)
                         .count();
      if (stopping || !block->error.empty())
        return -1;
      auto offset = position % block_size;
      auto count =
          std::min<uint64_t>(block->data.size() - offset, length - copied);
      std::memcpy(static_cast<char *>(output) + copied,
                  block->data.data() + offset, count);
      position += count;
      copied += count;
      // One speculative adjacent block; stale queued prefetch is discarded
      // on every new access. Critical work is always first, never cancelled.
      for (auto i = jobs.begin(); i != jobs.end();) {
        if (i->prefetch) {
          blocks.erase(key(*i->file, i->index));
          i = jobs.erase(i);
        } else
          ++i;
      }
      if (position / block_size == index && (index + 1) * block_size < f->size)
        enqueue(f, index + 1, true);
    }
    return static_cast<int64_t>(copied);
  }
};
std::unique_ptr<Reader> reader;
retro_vfs_interface local{}, decorated{};
struct Handle {
  retro_vfs_file_handle *native = nullptr;
  std::shared_ptr<File> remote;
  uint64_t position = 0;
};
Handle *h(retro_vfs_file_handle *f) { return reinterpret_cast<Handle *>(f); }
std::shared_ptr<File> remote(const char *p) {
  if (!reader || !p)
    return {};
  auto i = reader->files.find(p);
  return i == reader->files.end() ? nullptr : i->second;
}
retro_vfs_file_handle *open_file(const char *p, unsigned mode, unsigned hints) {
  auto out = std::make_unique<Handle>();
  out->remote = remote(p);
  if (out->remote) {
    if (mode != RETRO_VFS_FILE_ACCESS_READ)
      return nullptr;
  } else {
    out->native = local.open(p, mode, hints);
    if (!out->native)
      return nullptr;
  }
  return reinterpret_cast<retro_vfs_file_handle *>(out.release());
}
int close_file(retro_vfs_file_handle *f) {
  std::unique_ptr<Handle> owner(h(f));
  return owner->remote ? 0 : local.close(owner->native);
}
const char *path_file(retro_vfs_file_handle *f) {
  return h(f)->remote ? h(f)->remote->path.c_str()
                      : local.get_path(h(f)->native);
}
int64_t size_file(retro_vfs_file_handle *f) {
  return h(f)->remote ? static_cast<int64_t>(h(f)->remote->size)
                      : local.size(h(f)->native);
}
int64_t tell_file(retro_vfs_file_handle *f) {
  return h(f)->remote ? static_cast<int64_t>(h(f)->position)
                      : local.tell(h(f)->native);
}
int64_t seek_file(retro_vfs_file_handle *f, int64_t offset, int origin) {
  auto *s = h(f);
  if (!s->remote)
    return local.seek(s->native, offset, origin);
  int64_t base = origin == RETRO_VFS_SEEK_POSITION_START ? 0
                 : origin == RETRO_VFS_SEEK_POSITION_CURRENT
                     ? static_cast<int64_t>(s->position)
                 : origin == RETRO_VFS_SEEK_POSITION_END
                     ? static_cast<int64_t>(s->remote->size)
                     : -1;
  if (base < 0 || offset < -base ||
      offset > static_cast<int64_t>(s->remote->size) - base)
    return -1;
  s->position = base + offset;
  return static_cast<int64_t>(s->position);
}
int64_t read_file(retro_vfs_file_handle *f, void *p, uint64_t n) {
  try {
    return h(f)->remote ? reader->read(h(f)->remote, h(f)->position, p, n)
                        : local.read(h(f)->native, p, n);
  } catch (...) {
    return -1;
  }
}
int64_t write_file(retro_vfs_file_handle *f, const void *p, uint64_t n) {
  return h(f)->remote ? -1 : local.write(h(f)->native, p, n);
}
int flush_file(retro_vfs_file_handle *f) {
  return h(f)->remote ? 0 : local.flush(h(f)->native);
}
int64_t truncate_file(retro_vfs_file_handle *f, int64_t n) {
  return h(f)->remote ? -1 : local.truncate(h(f)->native, n);
}
int stat_file(const char *p, int32_t *size) {
  auto f = remote(p);
  if (!f)
    return local.stat(p, size);
  if (size)
    *size = static_cast<int32_t>(f->size);
  return RETRO_VFS_STAT_IS_VALID;
}
int remove_file(const char *p) { return remote(p) ? -1 : local.remove(p); }
int rename_file(const char *p, const char *q) {
  return remote(p) || remote(q) ? -1 : local.rename(p, q);
}
} // namespace
extern "C" void sfcb_vfs_install(retro_vfs_interface_info *info) {
  if (!info || !info->iface)
    return;
  const char *path = std::getenv("SFCB_DISC_MANIFEST");
  if (!path)
    return;
  try {
    reader = std::make_unique<Reader>(path);
    // RetroArch 1.22.2 provides VFS v3. Never read a newer struct tail.
    std::memcpy(&local, info->iface, offsetof(retro_vfs_interface, stat_64));
    decorated = local;
    decorated.open = open_file;
    decorated.close = close_file;
    decorated.get_path = path_file;
    decorated.size = size_file;
    decorated.tell = tell_file;
    decorated.seek = seek_file;
    decorated.read = read_file;
    decorated.write = write_file;
    decorated.flush = flush_file;
    decorated.truncate = truncate_file;
    decorated.stat = stat_file;
    decorated.remove = remove_file;
    decorated.rename = rename_file;
    info->iface = &decorated;
  } catch (const std::exception &e) {
    std::cerr << "disc-vfs: " << e.what() << std::endl;
  }
}
extern "C" void sfcb_vfs_shutdown() { reader.reset(); }
