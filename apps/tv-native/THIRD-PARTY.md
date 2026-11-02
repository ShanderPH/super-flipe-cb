# Native PoC: components and redistribution

Private build, 18 October 2026. Original Super Flip CB code has no new public
license assigned by this work. This is not a relicensing of the repository.

| Component | Source/version | License and obligations |
|---|---|---|
| RetroArch | webosbrew/RetroArch v1.22.2, 4c4953bf331348263cd68df0b654cf00583b437a | GPL-3.0-or-later; preserve notices and provide complete corresponding source and build changes when conveying binaries |
| Snes9x libretro | libretro/snes9x fae2fea08f74180759ef540ee94259213f503480 | Snes9x's individual license, including noncommercial restrictions; see Snes9x.txt and upstream's component notices |
| PCSX ReARMed | libretro/pcsx_rearmed c8816799b50388e61cfe237fe2cdbb7d8175f20a | GPL-2.0 family; COPYING and component notices apply; the two VFS lifecycle hooks are recorded in build.json |
| libchdr and bundled codecs | exact versions in the pinned PCSX source (including LZMA 26.02, miniz 3.1.2, zstd 1.5.7) | BSD/MIT/public-domain notices preserved under dependencies/pcsx; complete source archive retained |
| Archivo and Pixelify Sans | local TTF assets from Google Fonts, hashes recorded in build.json | SIL Open Font License 1.1; OFL notices accompany the fonts in assets |
| SDL webOS ABI | 2.30.12-webos.5 | Zlib; preserve copyright/notice and identify modifications if made |
| libcurl | SDK 8.22.0 | curl license (MIT-like); preserve notice |
| json-c | SDK 0.18 | MIT and component notices; preserve notice |
| OpenSSL | SDK 3.6.4 | Apache-2.0; include license and applicable notices |
| zlib | SDK version recorded in build logs | Zlib; preserve notice |
| libstdc++, libgcc_s, libatomic | SDK GCC 16.2.0 | GPL with GCC Runtime Library Exception, plus libstdc++ component notices; retain licenses/exception and review exact linked components before redistribution |
| EGL, GLES, PulseAudio, Wayland, fontconfig, FreeType, libc | commercial TV platform | Not redistributed by this package; target firmware provides its own ABI. SDK link stubs must never be shipped as drivers |
| libretro.h API | upstream libretro API | MIT; the runtime's use of this API does not change the licenses of RetroArch or cores |
| Icon | existing Super Flip CB geometric SF icon | Original existing project asset |

The SDK archive is pinned in runtime.lock.json. It is a build tool, not an app
dependency to install on the TV. Downloaded source archives remain under
artifacts/native/downloads; build.json identifies exact inputs, flags and binary
hashes. No ROM, BIOS or commercial cover is included in the native IPK.

No emulation, rendering, audio or input algorithm is modified. RetroArch has
three narrow exit/lifecycle bridge hooks to return to the native UI in the same
process; their source recipe is scripts/native/patch_runtime.py. PCSX acquires the remote
VFS decorator at its existing VFS seam and stops its I/O worker at retro_deinit.
Packaging sets app identity, config,
relative library search paths and a non-executable stack. Our C++ preparation
process executes RetroArch as a separate program. A later linked fork or copied
GPL implementation requires a corresponding source/licensing review. Personal
use does not grant permission to redistribute third-party code under a new license.

The notices in dependencies/sources.json identify the original URLs and hashes.
This inventory is not a claim that a new public release is licensed for distribution;
audit the full source tree and firmware SDK terms before any such release.
