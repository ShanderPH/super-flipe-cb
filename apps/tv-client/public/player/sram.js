export function validateSram(bytes, expectedSize) {
  if (
    !(bytes instanceof Uint8Array) ||
    !expectedSize ||
    bytes.byteLength !== expectedSize ||
    bytes.byteLength > 2 * 1024 * 1024
  )
    throw new Error(
      "SRAM incompatível com o tamanho informado por este jogo/core. Preserve o arquivo original.",
    );
}
export function sameBytes(a, b) {
  return (
    !!a && !!b && a.byteLength === b.byteLength && a.every((v, i) => v === b[i])
  );
}
export class SaveSync {
  constructor(upload, notify, initial = null, etag = '"0"') {
    this.upload = upload;
    this.notify = notify;
    this.baseline = initial?.slice() ?? null;
    this.etag = etag;
    this.busy = false;
    this.failures = 0;
    this.conflict = false;
  }
  async save(bytes, manual = false) {
    if (this.busy)
      throw new Error("Outra operação de progresso está em andamento.");
    if (!bytes?.byteLength) {
      if (manual)
        throw new Error(
          "Nenhum SRAM disponível. Salve primeiro dentro do jogo.",
        );
      return;
    }
    if (
      !manual &&
      (this.conflict || this.failures >= 3 || sameBytes(bytes, this.baseline))
    )
      return;
    if (this.conflict)
      throw new Error(
        "Conflito de progresso. Exporte esta sessão antes de restaurar o servidor.",
      );
    this.busy = true;
    const snapshot = bytes.slice(); // A runtime view can change while awaiting HTTP.
    this.notify("pending", "Progresso local em envio…");
    try {
      const response = await this.upload(snapshot, this.etag);
      if (response.status === 409) {
        this.conflict = true;
        throw new Error(
          "Conflito de progresso. Exporte esta sessão antes de restaurar o servidor.",
        );
      }
      if (!response.ok || !response.headers.get("etag"))
        throw new Error(
          "Save não confirmado. Tente novamente ou exporte antes de sair.",
        );
      this.etag = response.headers.get("etag");
      this.baseline = snapshot;
      this.failures = 0;
      this.notify("confirmed", "Progresso gravado no servidor.");
    } catch (error) {
      this.failures++;
      this.notify(
        this.conflict ? "conflict" : "unsent",
        this.conflict
          ? error.message
          : "Progresso local não confirmado no servidor. Após 3 falhas, tente salvar manualmente.",
      );
      throw error;
    } finally {
      this.busy = false;
    }
  }
  restored(bytes, etag) {
    this.baseline = bytes.slice();
    this.etag = etag;
    this.conflict = false;
    this.failures = 0;
  }
}
