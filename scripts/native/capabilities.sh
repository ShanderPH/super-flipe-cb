#!/bin/sh
# Explicit read-only Developer Mode diagnostic. Run only in an authorized TV session.
# Native graphics/audio/controller probing is a separate, interactive native-probe.
set -u
printf 'scope=developer-mode-read-only\n'
date -u
uname -a
id
printf '\nuserspace ELF header (class=1 means 32-bit; class=2 means 64-bit)\n'
od -An -t u1 -N 20 /bin/ls 2>/dev/null || true
printf '\ncpu\n'
cat /proc/cpuinfo 2>/dev/null || true
printf '\nprocess and system memory (different scopes)\n'
cat /proc/self/limits /proc/self/status /proc/meminfo 2>/dev/null || true
printf '\nfilesystem budgets\n'
df -Pk . /tmp /media/developer 2>/dev/null || true
printf '\ninput devices (listing does not prove application access)\n'
cat /proc/bus/input/devices 2>/dev/null || true
ls -l /dev/input /dev/snd 2>/dev/null || true
printf '\nplatform libraries (presence does not prove ABI compatibility)\n'
for dir in /usr/lib /lib /usr/lib32 /lib32; do
    for pattern in 'libEGL.so*' 'libGLESv2.so*' 'libSDL2*.so*' 'libpulse*.so*' 'libwayland*.so*' 'ld-linux*.so*'; do
        find "$dir" -maxdepth 1 -name "$pattern" -print 2>/dev/null || true
    done
done
printf '\nprocess mappings\n'
cat /proc/self/maps 2>/dev/null || true
printf '\nPhysical checks still required: native-probe, USB/Bluetooth, resume, audio, saves and sustained pacing.\n'
