import { translate, type MessageKey } from "./index.ts";

export class LocalizedError extends Error {
  readonly key: MessageKey;
  constructor(key: MessageKey) {
    super(translate("en", key));
    this.key = key;
  }
}

export class LocalizedRangeError extends RangeError {
  readonly key: MessageKey;
  constructor(key: MessageKey) {
    super(translate("en", key));
    this.key = key;
  }
}
