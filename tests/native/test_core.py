"""Native desktop libretro contract smoke test; never a TV benchmark or production host."""

import argparse
import ctypes as c
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def smoke(core_path):
    spec = importlib.util.spec_from_file_location(
        "test_rom", ROOT / "scripts/native/make-test-rom.py"
    )
    rom_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rom_module)
    content = rom_module.generate()
    library = c.CDLL(str(core_path.resolve()))
    environment_type = c.CFUNCTYPE(c.c_bool, c.c_uint, c.c_void_p)
    video_type = c.CFUNCTYPE(None, c.c_void_p, c.c_uint, c.c_uint, c.c_size_t)
    batch_type = c.CFUNCTYPE(c.c_size_t, c.POINTER(c.c_int16), c.c_size_t)
    sample_type = c.CFUNCTYPE(None, c.c_int16, c.c_int16)
    poll_type = c.CFUNCTYPE(None)
    input_type = c.CFUNCTYPE(c.c_int16, c.c_uint, c.c_uint, c.c_uint, c.c_uint)
    counts = {
        "coreFrames": 0,
        "videoCallbacks": 0,
        "audioSampleFrames": 0,
        "inputPolls": 0,
    }
    pixel_formats = []
    directory = tempfile.TemporaryDirectory()
    directory_bytes = directory.name.encode()

    @environment_type
    def environment(command, data):
        command &= 0xFFFF
        if command in (9, 30, 31):
            c.cast(data, c.POINTER(c.c_char_p))[0] = directory_bytes
            return True
        if command == 10:
            pixel = c.cast(data, c.POINTER(c.c_int))[0]
            pixel_formats.append(pixel)
            return pixel in (0, 1, 2)
        if command == 3:
            c.cast(data, c.POINTER(c.c_bool))[0] = True
            return True
        if command == 17:
            c.cast(data, c.POINTER(c.c_bool))[0] = False
            return True
        if command == 52:
            c.cast(data, c.POINTER(c.c_uint))[0] = 0
            return True
        return command in (11, 16, 18, 35, 37)

    @video_type
    def video(_data, width, height, pitch):
        if width and height and pitch:
            counts["videoCallbacks"] += 1

    @batch_type
    def audio(_data, frames):
        counts["audioSampleFrames"] += frames
        return frames

    @sample_type
    def sample(_left, _right):
        counts["audioSampleFrames"] += 1

    @poll_type
    def poll():
        counts["inputPolls"] += 1

    @input_type
    def input_state(_port, _device, _index, _button):
        return 0

    callbacks = {
        "retro_set_environment": (environment_type, environment),
        "retro_set_video_refresh": (video_type, video),
        "retro_set_audio_sample_batch": (batch_type, audio),
        "retro_set_audio_sample": (sample_type, sample),
        "retro_set_input_poll": (poll_type, poll),
        "retro_set_input_state": (input_type, input_state),
    }
    for name, (kind, callback) in callbacks.items():
        getattr(library, name).argtypes = [kind]
        getattr(library, name)(callback)
    library.retro_api_version.restype = c.c_uint
    assert library.retro_api_version() == 1

    class Game(c.Structure):
        _fields_ = [
            ("path", c.c_char_p),
            ("data", c.c_void_p),
            ("size", c.c_size_t),
            ("meta", c.c_char_p),
        ]

    library.retro_load_game.argtypes = [c.POINTER(Game)]
    library.retro_load_game.restype = c.c_bool
    library.retro_get_memory_size.argtypes = [c.c_uint]
    library.retro_get_memory_size.restype = c.c_size_t
    library.retro_get_memory_data.argtypes = [c.c_uint]
    library.retro_get_memory_data.restype = c.c_void_p
    library.retro_serialize_size.restype = c.c_size_t
    library.retro_serialize.argtypes = [c.c_void_p, c.c_size_t]
    library.retro_serialize.restype = c.c_bool
    library.retro_unserialize.argtypes = [c.c_void_p, c.c_size_t]
    library.retro_unserialize.restype = c.c_bool
    rom_buffer = c.create_string_buffer(content)
    game = Game(
        b"superflip-native-test.sfc", c.cast(rom_buffer, c.c_void_p), len(content), None
    )
    library.retro_init()
    loaded = False
    try:
        # Repeated load/unload catches a host/core lifecycle regression.
        for cycle in range(2):
            assert library.retro_load_game(c.byref(game)), (
                "Core rejected original diagnostic ROM"
            )
            loaded = True
            for _ in range(180):
                library.retro_run()
                counts["coreFrames"] += 1
            size = library.retro_get_memory_size(0)
            memory = library.retro_get_memory_data(0)
            assert size == 2048 and memory, "Expected diagnostic battery SRAM"
            before = c.string_at(memory, size)
            assert before[0] not in (0, 0x53), "65c816 diagnostic did not update SRAM"
            state_size = library.retro_serialize_size()
            assert state_size > 0
            state = c.create_string_buffer(state_size)
            assert library.retro_serialize(state, state_size)
            for _ in range(10):
                library.retro_run()
                counts["coreFrames"] += 1
            assert c.string_at(memory, size) != before
            assert library.retro_unserialize(state, state_size)
            assert c.string_at(library.retro_get_memory_data(0), size) == before
            library.retro_unload_game()
            loaded = False
        assert counts["videoCallbacks"] > 300 and counts["audioSampleFrames"] > 100000
        assert counts["inputPolls"] >= 300 and pixel_formats
        return {
            "scope": "desktop native core with test callbacks; no TV/GPU/audio-device proof",
            "coreSha256": hashlib.sha256(core_path.read_bytes()).hexdigest(),
            "romSha256": hashlib.sha256(content).hexdigest(),
            "cycles": 2,
            "sramBytes": size,
            "serializeRoundtrip": True,
            "counts": counts,
        }
    finally:
        if loaded:
            library.retro_unload_game()
        library.retro_deinit()
        directory.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = smoke(args.core)
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
