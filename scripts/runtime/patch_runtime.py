"""Small, reproducible patches against the audited EmulatorJS 4.2.3 sources."""
import hashlib
from pathlib import Path

PINS = {
    "emulator.js": "24ebac4baf739892046b82c3bdf01d5b6795b801b77d289e43a4c7d59f9666be",
    "GameManager.js": "f026130eda3648557498c54c70cbb5b36fd71b088e7e42e5a13e413aab11d888",
    "gamepad.js": "27707ee9256cf3e1a6f32d1c3c42f2aed991d637773699fff566008229cc09c8",
}
MARKER = "// Super Flip CB input and SRAM integration patch 1\n"
PATCHED = {
    "emulator.js": "c717d5c04e6a79940249eeb416fe82d0ddcb78de3881ebd7993b159cd21c2400",
    "GameManager.js": "01adc8077a363fc69eabc092342a292268d024c389b44205de1ce9a64261d7e6",
    "gamepad.js": "1743e71b04a78dc72727819633899817ea497cdb491284655f58c175322eff71",
}


def apply(data: Path):
    for name, digest in PINS.items():
        path = data / "src" / name
        source = path.read_bytes()
        if source.startswith(MARKER.encode()):
            if hashlib.sha256(source).hexdigest() != PATCHED[name]:
                raise RuntimeError(f"Patched source changed: {name}; preserve and inspect it")
            continue
        if hashlib.sha256(source).hexdigest() != digest:
            raise RuntimeError(f"Unexpected upstream source: {name}; refusing patch")
        text = source.decode()
        if name == "emulator.js":
            text = text.replace(
                '        if (this.debug || (window.location && ["localhost", "127.0.0.1"].includes(location.hostname))) this.checkForUpdates();',
                '        // Super Flip uses verified local updates, never a CDN version check.',
            ).replace(
                '            if (!this.gamepadLabels) return;',
                '            if (!this.gamepadLabels) return;\n'
                '            const pad = this.gamepad.gamepads.find(p => p.index === e.gamepadIndex);\n'
                '            if (!pad) return;',
            ).replace(
                'this.gamepad.gamepads[e.gamepadIndex].id + "_" + this.gamepad.gamepads[e.gamepadIndex].index',
                'pad.id + "_" + pad.index',
            ).replace(
                '    gamepadEvent(e) {\n        if (!this.started) return;',
                '    gamepadEvent(e) {\n        if (!this.started) return;\n'
                '        const pad = this.gamepad.gamepads.find(p => p.index === e.gamepadIndex);\n'
                '        if (!pad) return;',
            ).replace(
                '            const gamepadSelection = this.gamepad.gamepads[gamepadIndex].id',
                '            if (gamepadIndex < 0) return;\n'
                '            const gamepadSelection = this.gamepad.gamepads[gamepadIndex].id',
            )
        elif name == "GameManager.js":
            text = text.replace(
                '    simulateInput(player, index, value) {',
                '    simulateInput(player, index, value) {\n'
                '        if (this.EJS.config?.superFlip &&\n'
                '            (index >= 12 || !this.EJS.config.superFlip.allowInput())) return;\n'
                '        if (this.EJS.paused && value !== 0) return;',
            ).replace(
                '            this.FS.mount(this.FS.filesystems.IDBFS,',
                '            if (this.EJS.config.superFlip) { resolve(); return; }\n'
                '            this.FS.mount(this.FS.filesystems.IDBFS,',
            ).replace(
                '            this.FS.unmount("/data/saves");',
                '            if (!this.EJS.config.superFlip) this.FS.unmount("/data/saves");',
            )
        else:
            text = text.replace(
                '        return navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads() : []);',
                '        try {\n'
                '            return navigator.getGamepads ? navigator.getGamepads() : [];\n'
                '        } catch { return []; }',
            )
        if name == "emulator.js":
            start = text.index('            if (res === -1) {\n                console.log("File not found')
            end = text.index('            gotCore(res.data);', start)
            text = (text[:start] + '            if (res === -1) {\n'
                    '                this.startGameError("Core local indisponivel. Verifique o runtime no servidor.");\n'
                    '                this.callEvent("exit");\n'
                    '                return;\n            }\n' + text[end:])
        patched = (MARKER + text).encode()
        if hashlib.sha256(patched).hexdigest() != PATCHED[name]:
            raise RuntimeError(f"Patch result did not match verified source: {name}")
        path.write_bytes(patched)


if __name__ == "__main__":
    apply(Path(__file__).resolve().parents[2] / "vendor/emulatorjs/data")
