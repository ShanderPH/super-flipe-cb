// Run explicitly on the device. No firmware/service changes or persistent writes.
#include <SDL.h>
#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <dlfcn.h>
#include <json-c/json.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/statvfs.h>
#include <sys/utsname.h>
#include <unistd.h>

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <string>

namespace {
void text(json_object* o, const char* key, const char* value) {
    json_object_object_add(o, key, value ? json_object_new_string(value) : nullptr);
}
void number(json_object* o, const char* key, std::int64_t value) {
    json_object_object_add(o, key, json_object_new_int64(value));
}
void silence(void*, Uint8* stream, int length) { SDL_memset(stream, 0, length); }
}

int main(int argc, char** argv) {
    int seconds = 0;
    if (argc == 3 && std::string(argv[1]) == "--seconds") {
        try { seconds = std::stoi(argv[2]); } catch (...) { return 2; }
        if (seconds < 0 || seconds > 60) return 2;
    } else if (argc != 1) return 2;
    auto* out = json_object_new_object();
    text(out, "scope", "native process; physical acceptance still required");
    number(out, "pointerBits", sizeof(void*) * 8);
    utsname kernel{};
    if (::uname(&kernel) == 0) {
        text(out, "kernelArchitecture", kernel.machine);
        text(out, "kernelRelease", kernel.release);
    }
    number(out, "pageBytes", ::sysconf(_SC_PAGESIZE));
    rlimit limit{};
    if (::getrlimit(RLIMIT_AS, &limit) == 0) {
        if (limit.rlim_cur == RLIM_INFINITY) text(out, "addressSpaceLimit", "unlimited is not available RAM");
        else number(out, "addressSpaceLimit", static_cast<std::int64_t>(limit.rlim_cur));
    }
    struct statvfs storage{};
    if (::statvfs(".", &storage) == 0)
        number(out, "appFilesystemAvailableBytes", static_cast<std::int64_t>(storage.f_bavail) * storage.f_frsize);
    void* page = ::mmap(nullptr, 4096, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    const bool executable = page != MAP_FAILED && ::mprotect(page, 4096, PROT_READ | PROT_EXEC) == 0;
    json_object_object_add(out, "rwToRxMappingAllowed", json_object_new_boolean(executable));
    text(out, "dynarecStatus", "not tested; mapping permission alone does not validate a dynarec");
    if (page != MAP_FAILED) ::munmap(page, 4096);
    const auto core = std::filesystem::canonical("/proc/self/exe").parent_path() / "cores/snes9x_libretro.so";
    void* library = ::dlopen(core.c_str(), RTLD_NOW | RTLD_LOCAL);
    json_object_object_add(out, "coreDlopen", json_object_new_boolean(library != nullptr));
    if (library) ::dlclose(library);
    else text(out, "coreDlopenError", ::dlerror());
    SDL_version compiled{}, linked{};
    SDL_VERSION(&compiled); SDL_GetVersion(&linked);
    const auto version = [](SDL_version v) { return std::to_string(v.major) + "." +
        std::to_string(v.minor) + "." + std::to_string(v.patch); };
    text(out, "sdlCompiled", version(compiled).c_str());
    text(out, "sdlLinked", version(linked).c_str());
    auto* videos = json_object_new_array();
    for (int i = 0; i < SDL_GetNumVideoDrivers(); ++i)
        json_object_array_add(videos, json_object_new_string(SDL_GetVideoDriver(i)));
    json_object_object_add(out, "availableVideoDrivers", videos);
    auto* audios = json_object_new_array();
    for (int i = 0; i < SDL_GetNumAudioDrivers(); ++i)
        json_object_array_add(audios, json_object_new_string(SDL_GetAudioDriver(i)));
    json_object_object_add(out, "availableAudioDrivers", audios);
    const int initialized = SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO | SDL_INIT_GAMECONTROLLER);
    text(out, "sdlInitError", initialized == 0 ? nullptr : SDL_GetError());
    text(out, "videoDriver", SDL_GetCurrentVideoDriver());
    text(out, "audioDriver", SDL_GetCurrentAudioDriver());
    SDL_Window* window = nullptr;
    SDL_GLContext context = nullptr;
    if (initialized == 0) {
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 2);
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
        window = SDL_CreateWindow("Super Flip CB diagnostic", SDL_WINDOWPOS_UNDEFINED,
            SDL_WINDOWPOS_UNDEFINED, 1920, 1080, SDL_WINDOW_OPENGL | SDL_WINDOW_FULLSCREEN);
        if (window) context = SDL_GL_CreateContext(window);
    }
    if (context) {
        text(out, "glVersion", reinterpret_cast<const char*>(glGetString(GL_VERSION)));
        text(out, "glRenderer", reinterpret_cast<const char*>(glGetString(GL_RENDERER)));
        text(out, "glVendor", reinterpret_cast<const char*>(glGetString(GL_VENDOR)));
        text(out, "eglVersion", eglQueryString(eglGetCurrentDisplay(), EGL_VERSION));
        text(out, "eglExtensions", eglQueryString(eglGetCurrentDisplay(), EGL_EXTENSIONS));
        number(out, "swapIntervalResult", SDL_GL_SetSwapInterval(1));
        int w = 0, h = 0; SDL_GL_GetDrawableSize(window, &w, &h);
        number(out, "drawableWidth", w); number(out, "drawableHeight", h);
        glClearColor(0.063f, 0.075f, 0.129f, 1.0f); glClear(GL_COLOR_BUFFER_BIT);
        SDL_GL_SwapWindow(window);
    } else text(out, "glError", SDL_GetError());
    SDL_AudioSpec desired{}, actual{};
    desired.freq = 48000; desired.format = AUDIO_S16SYS; desired.channels = 2;
    desired.samples = 1024; desired.callback = silence;
    const auto audio = initialized == 0 ? SDL_OpenAudioDevice(nullptr, 0, &desired, &actual, 0) : 0;
    if (audio) {
        number(out, "audioFrequency", actual.freq); number(out, "audioSamples", actual.samples);
        text(out, "audioEvidence", "silent device opened; audible quality and RetroArch PulseAudio still pending");
        SDL_PauseAudioDevice(audio, 0);
    } else text(out, "audioOpenError", SDL_GetError());
    auto* devices = json_object_new_array();
    for (int i = 0; i < SDL_NumJoysticks(); ++i) {
        auto* device = json_object_new_object();
        text(device, "name", SDL_JoystickNameForIndex(i));
        json_object_object_add(device, "controllerMapped", json_object_new_boolean(SDL_IsGameController(i)));
        char guid[33]{}; SDL_JoystickGetGUIDString(SDL_JoystickGetDeviceGUID(i), guid, sizeof(guid));
        text(device, "guid", guid); json_object_array_add(devices, device);
    }
    json_object_object_add(out, "gamepads", devices);
    int added = 0, removed = 0, focus_lost = 0;
    const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
    bool quit = false;
    while (!quit && std::chrono::steady_clock::now() < end) {
        SDL_Event event;
        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_QUIT) quit = true;
            if (event.type == SDL_JOYDEVICEADDED) ++added;
            if (event.type == SDL_JOYDEVICEREMOVED) ++removed;
            if (event.type == SDL_WINDOWEVENT && event.window.event == SDL_WINDOWEVENT_FOCUS_LOST) ++focus_lost;
        }
        SDL_Delay(10);
    }
    number(out, "hotplugAddedEvents", added); number(out, "hotplugRemovedEvents", removed);
    number(out, "focusLostEvents", focus_lost);
    if (audio) SDL_CloseAudioDevice(audio);
    if (context) SDL_GL_DeleteContext(context);
    if (window) SDL_DestroyWindow(window);
    SDL_Quit();
    std::cout << json_object_to_json_string_ext(out, JSON_C_TO_STRING_PRETTY) << '\n';
    json_object_put(out);
    return initialized == 0 && context && audio && library ? 0 : 1;
}
