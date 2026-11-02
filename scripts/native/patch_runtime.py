"""Isolated RetroArch lifecycle bridge; emulation and A/V algorithms are unchanged."""

from pathlib import Path


def patched_files(source: Path):
    result = {}
    path = source / "retroarch.c"
    text = path.read_text()
    main = "   return rarch_main(argc, argv, NULL);"
    if text.count(main) != 1:
        raise ValueError("RetroArch main seam changed")
    text = text.replace(
        "int rarch_main(int argc, char *argv[], void *data)",
        "#if defined(WEBOS)\n#include <signal.h>\nvolatile sig_atomic_t sfcb_close_requested = 0;\n#endif\n\nint rarch_main(int argc, char *argv[], void *data)",
    )
    text = text.replace(
        main,
        """   int result = rarch_main(argc, argv, NULL);
#if defined(WEBOS)
   const char *ui = getenv("SFCB_UI_EXEC");
   const char *state = getenv("SFCB_STATE_DIR");
   const char *cache = getenv("SFCB_CACHE_DIR");
   if (ui && state && cache && !sfcb_close_requested)
   {
      char code[16];
      snprintf(code, sizeof(code), "%d", result);
      setenv("SFCB_RUNTIME_RESULT", code, 1);
      execl(ui, ui, "--state-dir", state, "--cache-dir", cache, (char*)NULL);
   }
#endif
   return result;""",
    )
    result["retroarch.c"] = text
    name = "frontend/drivers/platform_unix.c"
    text = (source / name).read_text()
    needle = "static void frontend_unix_sighandler(int sig)\n{"
    if text.count(needle) != 1:
        raise ValueError("RetroArch signal seam changed")
    text = text.replace(
        needle,
        needle
        + "\n#if defined(WEBOS)\n   extern volatile sig_atomic_t sfcb_close_requested;\n   if (sig != SIGUSR1) sfcb_close_requested = 1;\n#endif",
    )
    text = text.replace(
        "   sigaction(SIGTERM, &sa, NULL);",
        '   sigaction(SIGTERM, &sa, NULL);\n#ifdef WEBOS\n   if (getenv("SFCB_RUNTIME_ACTIVE")) sigaction(SIGUSR1, &sa, NULL);\n#endif',
    )
    result[name] = text
    name = "gfx/drivers_context/sdl_gl_ctx.c"
    text = (source / name).read_text()
    # webOS reports native foreground/background even without keyboard focus
    # (gamepad/non-magic remote). Use that signal for this launcher only; the
    # baseline SDL policy remains available for other runtime callers.
    text = text.replace(
        "   bool subsystem_inited;",
        "   bool subsystem_inited;\n#ifdef WEBOS\n   SDL_atomic_t sfcb_foreground;\n#endif",
    )
    needle = "/* TODO/FIXME - static global */"
    if text.count(needle) != 1:
        raise ValueError("SDL context declaration seam changed")
    text = text.replace(
        needle,
        """#ifdef WEBOS
/* Observe events when SDL pumps them, including while video is paused. */
static int SDLCALL sfcb_lifecycle_watch(void *data, SDL_Event *event)
{
   gfx_ctx_sdl_data_t *sdl = (gfx_ctx_sdl_data_t*)data;
   int active = -1;
   if (event->type == SDL_APP_WILLENTERBACKGROUND || event->type == SDL_APP_DIDENTERBACKGROUND)
      active = 0;
   else if (event->type == SDL_APP_DIDENTERFOREGROUND)
      active = 1;
   else if (event->type == SDL_WINDOWEVENT && sdl->win &&
            event->window.windowID == SDL_GetWindowID(sdl->win))
   {
      if (event->window.event == SDL_WINDOWEVENT_MINIMIZED) active = 0;
      else if (event->window.event == SDL_WINDOWEVENT_RESTORED) active = 1;
   }
   if (active >= 0 && SDL_AtomicSet(&sdl->sfcb_foreground, active) != active)
      RARCH_LOG("[Super Flip CB] Native window entered %s.\\n", active ? "foreground" : "background");
   return 1;
}
#endif

""" + needle,
    )
    needle = "   sdl_ctx_destroy_resources(sdl);"
    text = text.replace(
        needle,
        "#ifdef WEBOS\n   SDL_DelEventWatch(sfcb_lifecycle_watch, sdl);\n#endif\n" + needle,
    )
    needle = "   return sdl;"
    if text.count(needle) != 1:
        raise ValueError("SDL context initialized seam changed")
    text = text.replace(
        needle,
        '#ifdef WEBOS\n   if (getenv("SFCB_RUNTIME_ACTIVE")) SDL_AddEventWatch(sfcb_lifecycle_watch, sdl);\n#endif\n' + needle,
    )
    needle = "   return (SDL_GetWindowFlags(sdl->win) & flags) == flags;"
    if text.count(needle) != 1:
        raise ValueError("SDL focus seam changed")
    text = text.replace(
        needle,
        """   {
#ifdef WEBOS
      unsigned current = SDL_GetWindowFlags(sdl->win);
      if (getenv("SFCB_RUNTIME_ACTIVE"))
         return SDL_AtomicGet(&sdl->sfcb_foreground) && (current & SDL_WINDOW_SHOWN) &&
                !(current & SDL_WINDOW_MINIMIZED);
#endif
      return (SDL_GetWindowFlags(sdl->win) & flags) == flags;
   }""",
    )
    # Window-manager close must close the app; menu Quit returns to our UI.
    needle = "case SDL_QUIT:"
    if text.count(needle) != 1:
        raise ValueError("SDL quit seam changed")
    text = text.replace(
        needle,
        needle
        + "\n#ifdef WEBOS\n            { extern volatile sig_atomic_t sfcb_close_requested; sfcb_close_requested = 1; }\n#endif",
    )
    result[name] = text
    return result
