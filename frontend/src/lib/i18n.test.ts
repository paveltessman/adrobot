import assert from "node:assert/strict";
import { test } from "node:test";

import {
  displaySchema,
  displayState,
  resolveLocale,
  translate,
} from "./i18n/index.ts";
import { LocalizedError, LocalizedRangeError } from "./i18n/errors.ts";
import { creationError, type CreationDraft } from "./campaign-create.ts";
import { en, ru } from "./i18n/messages.ts";

test("accepts supported locales and defaults missing or invalid cookies to English", () => {
  assert.equal(resolveLocale("ru"), "ru");
  assert.equal(resolveLocale("en"), "en");
  for (const value of [undefined, null, "", "fr", "RU", "ru-RU", {}, 1]) {
    assert.equal(resolveLocale(value), "en");
  }
});

test("dictionaries have matching keys and interpolation parameters", () => {
  function compare(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
  ) {
    assert.deepEqual(Object.keys(left).sort(), Object.keys(right).sort());
    for (const [key, a] of Object.entries(left)) {
      const b = right[key];
      if (typeof a === "string") {
        assert.ok(typeof b === "string");
        assert.deepEqual(a.match(/\{\w+\}/g), b.match(/\{\w+\}/g));
      } else {
        assert.ok(a && b && typeof a === "object" && typeof b === "object");
        compare(a as Record<string, unknown>, b as Record<string, unknown>);
      }
    }
  }
  compare(en, ru);
});

test("translates metadata and interpolates plural messages", () => {
  assert.equal(translate("en", "metadataTitle"), en.metadataTitle);
  assert.equal(translate("ru", "metadataDescription"), ru.metadataDescription);
  assert.equal(translate("en", "offersCount", { count: 1 }), "1 offer");
  assert.equal(translate("en", "offersCount", { count: 2 }), "2 offers");
  for (const [count, noun] of [
    [0, "офферов"],
    [1, "оффер"],
    [2, "оффера"],
    [5, "офферов"],
    [11, "офферов"],
    [12, "офферов"],
    [21, "оффер"],
    [22, "оффера"],
    [25, "офферов"],
    [101, "оффер"],
    [1.5, "оффера"],
  ] as const) {
    assert.equal(translate("ru", "offersCount", { count }), `${count} ${noun}`);
  }
});

test("rejects missing or invalid counts instead of displaying broken messages", () => {
  for (const count of [undefined, "2", NaN, Infinity]) {
    assert.throws(
      () => translate("ru", "offersCount", { count: count as number }),
      TypeError,
    );
  }
});

test("interpolates complete sentences without treating user content as a template", () => {
  assert.equal(
    translate("ru", "openDetails", { name: "Summer {campaign} <test>" }),
    "Открыть кампанию «Summer {campaign} <test>»",
  );
  assert.throws(() => translate("ru", "openDetails"), TypeError);
});

test("domain errors retain stable identifiers and English diagnostic text", () => {
  const error = new LocalizedError("offerNoLongerAvailable");
  assert.equal(error.key, "offerNoLongerAvailable");
  assert.equal(error.message, "This offer is no longer available.");
  assert.equal(translate("ru", error.key), "Этот оффер больше недоступен.");
  const rangeError = new LocalizedRangeError("enterCampaignName");
  assert.ok(rangeError instanceof RangeError);
  assert.equal(translate("ru", rangeError.key), "Введите название кампании.");
});

test("creation validation returns identifiers that can be displayed in either language", () => {
  const draft: CreationDraft = {
    name: "",
    countryCodes: "",
    offer: null,
    domainId: "",
    groupId: "",
    sourceId: "",
  };
  assert.equal(creationError(draft), "enterCampaignName");
  assert.equal(
    creationError({ ...draft, name: "Summer" }),
    "enterCountryCodes",
  );
  assert.equal(
    creationError({ ...draft, name: "Summer", countryCodes: "AU" }),
    "selectAvailableOffer",
  );
});

test("localizes known tracker values and preserves unknown values", () => {
  assert.equal(displayState("en", "active"), "active");
  assert.equal(displayState("ru", "active"), "активен");
  assert.equal(displayState("ru", "disabled"), "отключён");
  assert.equal(displayState("ru", "custom-state"), "custom-state");
  assert.equal(displaySchema("ru", "redirect"), "переадресация");
  assert.equal(displaySchema("ru", "landings"), "офферы");
  assert.equal(displaySchema("ru", "custom-schema"), "custom-schema");
});
