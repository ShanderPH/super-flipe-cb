#include "../../apps/tv-native/third_party/libretro.h"
#include <cstdlib>
#include <iostream>
#include <openssl/sha.h>
#include <string>
#include <vector>
extern "C" void sfcb_vfs_install(retro_vfs_interface_info *);
extern "C" void sfcb_vfs_shutdown();
int main(int argc, char **argv) {
  if (argc < 5)
    return 2;
  setenv("SFCB_DISC_MANIFEST", argv[1], 1);
  retro_vfs_interface original{};
  retro_vfs_interface_info info{3, &original};
  sfcb_vfs_install(&info);
  if (info.iface == &original)
    return 3;
  auto *file = info.iface->open(argv[2], RETRO_VFS_FILE_ACCESS_READ, 0);
  if (!file)
    return 4;
  for (int arg = 3; arg + 1 < argc; arg += 2) {
    auto offset = std::stoll(argv[arg]), size = std::stoll(argv[arg + 1]);
    if (info.iface->seek(file, offset, RETRO_VFS_SEEK_POSITION_START) != offset)
      return 5;
    std::vector<unsigned char> data(size);
    auto n = info.iface->read(file, data.data(), size);
    if (n != size) {
      info.iface->close(file);
      sfcb_vfs_shutdown();
      return 6;
    }
    unsigned char digest[32];
    SHA256(data.data(), data.size(), digest);
    const char *hex = "0123456789abcdef";
    for (auto c : digest)
      std::cout << hex[c >> 4] << hex[c & 15];
    std::cout << '\n';
  }
  info.iface->close(file);
  sfcb_vfs_shutdown();
  return 0;
}
