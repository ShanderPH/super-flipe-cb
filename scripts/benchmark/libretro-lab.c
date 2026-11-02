/* Read-only experiment, not a production save/core adapter. libretro ABI. */
#include <stdint.h>
#include <string.h>
#include <emscripten.h>
#include "libretro.h"
#define API EMSCRIPTEN_KEEPALIVE
static uint8_t rgba[512 * 512 * 4];
static int16_t audio[16384];
static unsigned width, height, samples, pixel_format, mask, overflow;
static double fps, rate, metrics[4];
static int profiling;
static bool environment(unsigned cmd, void *data) {
  switch (cmd) {
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
      pixel_format = *(unsigned *)data;
      return pixel_format == RETRO_PIXEL_FORMAT_RGB565 || pixel_format == RETRO_PIXEL_FORMAT_0RGB1555;
    case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool *)data = true; return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: *(bool *)data = false; return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: return false; /* core defaults, no overclock/frameskip */
    case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: *(unsigned *)data = 0; return true;
    case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS: return true;
    default: return false;
  }
}
static void video(const void *data, unsigned w, unsigned h, size_t pitch) {
  if (!data) return;
  if (w > 512 || h > 512) { overflow = 1; return; }
  const double start = profiling ? emscripten_get_now() : 0;
  width = w; height = h;
  for (unsigned y = 0; y < h; ++y) {
    const uint16_t *row = (const uint16_t *)((const uint8_t *)data + y * pitch);
    for (unsigned x = 0; x < w; ++x) {
      const uint16_t p = row[x];
      const unsigned green_bits = pixel_format == RETRO_PIXEL_FORMAT_RGB565 ? 6 : 5;
      unsigned r = p >> (green_bits + 5) & 31;
      unsigned g = p >> 5 & ((1 << green_bits) - 1);
      unsigned b = p & 31;
      uint8_t *out = rgba + (y * w + x) * 4;
      out[0] = (r << 3) | (r >> 2);
      out[1] = (g << (8 - green_bits)) | (g >> (2 * green_bits - 8));
      out[2] = (b << 3) | (b >> 2); out[3] = 255;
    }
  }
  if (profiling) metrics[1] += emscripten_get_now() - start;
}
static size_t audio_batch(const int16_t *data, size_t frames) {
  const double start = profiling ? emscripten_get_now() : 0;
  if (samples + frames * 2 > sizeof(audio) / sizeof(*audio)) { overflow = 1; return frames; }
  memcpy(audio + samples, data, frames * 2 * sizeof(*data));
  samples += frames * 2;
  if (profiling) metrics[2] += emscripten_get_now() - start;
  return frames;
}
static void audio_sample(int16_t l, int16_t r) { const int16_t pair[] = {l,r}; audio_batch(pair,1); }
static void poll(void) {}
static int16_t input(unsigned port, unsigned device, unsigned index, unsigned id) {
  if (port || device != RETRO_DEVICE_JOYPAD || index) return 0;
  return id == RETRO_DEVICE_ID_JOYPAD_MASK ? mask : (id < 16 ? !!(mask & (1u << id)) : 0);
}
API int lab_load(const void *data, size_t size) {
  retro_set_environment(environment); retro_set_video_refresh(video);
  retro_set_audio_sample(audio_sample); retro_set_audio_sample_batch(audio_batch);
  retro_set_input_poll(poll); retro_set_input_state(input); retro_init();
  struct retro_game_info game = {"lab.sfc", data, size, 0};
  if (!retro_load_game(&game)) return 0;
  struct retro_system_av_info av; retro_get_system_av_info(&av);
  fps = av.timing.fps; rate = av.timing.sample_rate; return 1;
}
API void lab_profile(int enabled) { profiling = enabled; }
API void lab_input(unsigned value) { mask = value; }
API void lab_run(void) {
  samples = 0; memset(metrics, 0, sizeof(metrics));
  const double start = profiling ? emscripten_get_now() : 0;
  retro_run();
  if (profiling) { metrics[0] = emscripten_get_now() - start; metrics[3] = metrics[0] - metrics[1] - metrics[2]; }
}
API double lab_metric(unsigned i) { return i < 4 ? metrics[i] : 0; }
API double lab_fps(void) { return fps; }
API double lab_rate(void) { return rate; }
API unsigned lab_width(void) { return width; }
API unsigned lab_height(void) { return height; }
API void *lab_pixels(void) { return rgba; }
API void *lab_audio(void) { return audio; }
API unsigned lab_samples(void) { return samples; }
API unsigned lab_overflow(void) { return overflow; }
