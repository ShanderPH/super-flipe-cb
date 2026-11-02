#pragma once
#include <algorithm>
#include <cstdint>
#include <cstdlib>

// Turn the left stick into spatial menu commands, with hysteresis and repeat.
struct StickNavigation {
  int held = 0;
  uint64_t next_repeat = 0;
  int sample(int x, int y, uint64_t now) {
    const int magnitude = std::max(std::abs(x), std::abs(y));
    const int threshold = held ? 11000 : 18000;
    const int direction = magnitude < threshold       ? 0
                          : std::abs(x) > std::abs(y) ? (x < 0 ? 1 : 2)
                                                      : (y < 0 ? 3 : 4);
    if (direction != held) {
      held = direction;
      next_repeat = now + 350;
      return direction;
    }
    if (held && now >= next_repeat) {
      next_repeat = now + 120;
      return held;
    }
    return 0;
  }
};
