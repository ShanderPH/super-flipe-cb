// Temporary TV-loopback -> PC-loopback lab transport. No install or credentials in logs.
import { createRequire } from "node:module";
import { connect } from "node:net";
import { parseArgs } from "node:util";
const require = createRequire(
  new URL("../../tools/webos/package.json", import.meta.url),
);
const { values } = parseArgs({
  options: {
    device: { type: "string" },
    port: { type: "string", default: "8798" },
    authorization: { type: "string" },
  },
});
if (!values.authorization?.trim())
  throw new Error(
    "TV tunnel requires the user's explicit approval for this session; --authorization only records that approval.",
  );
const novacom = require("@webos-tools/cli/lib/base/novacom.js");
const port = Number(values.port);
if (!values.device || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Explicit --device and unprivileged --port required");
const session = await new Promise((resolve, reject) => {
  new novacom.Session(values.device, false, (error, opened) =>
    error
      ? reject(new Error("Cannot open configured TV SSH session"))
      : resolve(opened),
  );
});
const sockets = new Set();
session.ssh.on("tcp connection", (info, accept, reject) => {
  if (
    info.destIP !== "127.0.0.1" ||
    info.destPort !== port ||
    !["127.0.0.1", "::1"].includes(info.srcIP)
  )
    return reject();
  const stream = accept();
  stream.pause();
  const socket = connect({ host: "127.0.0.1", port }, () => {
    stream.pipe(socket).pipe(stream);
    stream.resume();
  });
  sockets.add(socket);
  socket.on("error", () => stream.destroy());
  stream.on("error", () => socket.destroy());
  stream.on("close", () => socket.destroy());
  socket.on("close", () => {
    sockets.delete(socket);
    stream.destroy();
  });
});
try {
  await new Promise((resolve, reject) =>
    session.ssh.forwardIn("127.0.0.1", port, (error) =>
      error
        ? reject(new Error("TV SSH server refused loopback forwarding"))
        : resolve(),
    ),
  );
} catch (error) {
  session.end();
  throw error;
}
console.log(
  `Temporary lab: TV http://127.0.0.1:${port} via SSH to PC loopback; stop with Ctrl+C`,
);
function stop() {
  for (const socket of sockets) socket.destroy();
  session.ssh.unforwardIn("127.0.0.1", port, () => session.end());
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
