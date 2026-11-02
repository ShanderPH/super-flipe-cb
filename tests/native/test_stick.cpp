#include "../../apps/tv-native/src/stick_navigation.h"
#include <cassert>

int main() {
  StickNavigation stick;
  // Center drift must not navigate; a deliberate tilt moves once, then repeats.
  assert(stick.sample(1000, -3000, 0) == 0);
  assert(stick.sample(-24000, 100, 10) == 1);
  assert(stick.sample(-24000, 100, 200) == 0);
  assert(stick.sample(-24000, 100, 360) == 1);
  assert(stick.sample(-24000, 100, 420) == 0);
  assert(stick.sample(-24000, 100, 480) == 1);
  // Hysteresis avoids retriggering around the activation threshold.
  assert(stick.sample(-15000, 0, 490) == 0);
  assert(stick.sample(0, 0, 500) == 0);
  assert(stick.sample(-15000, 0, 510) == 0);
  assert(stick.sample(-24000, 0, 520) == 1);
  // Direct reversal, dominant axis and full int16 range remain usable.
  assert(stick.sample(25000, 0, 530) == 2);
  assert(stick.sample(5000, -32768, 540) == 3);
  assert(stick.sample(5000, 32767, 550) == 4);
  stick = {}; // Disconnect/return-to-menu resets a held stick.
  assert(stick.sample(0, 0, 1000) == 0);
}
