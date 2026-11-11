import assert from "node:assert/strict";
import {
  mergeMessage,
  setMessageDeliveryStatus,
  sortMessages,
  type MessageRow,
} from "../lib/message-delivery";
import type { DirectMessage } from "../lib/types";

const first: MessageRow = {
  id: "message-1",
  conversation_id: "conversation-1",
  author_id: "user-1",
  author_name: "Awa",
  text: "Bonjour",
  created_at: "2026-01-01T10:00:00.000Z",
  deliveryStatus: "sending",
};
const second: MessageRow = {
  ...first,
  id: "message-2",
  text: "Deuxième message",
  created_at: "2026-01-01T10:01:00.000Z",
};

assert.deepEqual(sortMessages([second, first]).map((message) => message.id), [
  "message-1",
  "message-2",
]);
assert.equal(setMessageDeliveryStatus([first], first.id, "failed")?.[0].deliveryStatus, "failed");
assert.equal(setMessageDeliveryStatus(null, first.id, "failed"), null);

const acknowledgedMessage: DirectMessage = {
  id: first.id,
  conversation_id: first.conversation_id,
  author_id: first.author_id,
  author_name: first.author_name,
  text: first.text,
  created_at: first.created_at,
};
const acknowledged = mergeMessage([first], acknowledgedMessage);
assert.equal(acknowledged.length, 1);
assert.equal(acknowledged[0].deliveryStatus, undefined);
assert.equal(acknowledged[0].text, "Bonjour");

// Une correction arrive par realtime comme une ligne complète : elle
// remplace la bulle sur place, sans créer de doublon ni perdre sa place
// dans le fil.
const corrected: DirectMessage = {
  ...acknowledgedMessage,
  text: "Bonsoir",
  is_code: true,
  edited_at: "2026-01-01T10:05:00.000Z",
};
const afterEdit = mergeMessage(acknowledged, corrected);
assert.equal(afterEdit.length, 1);
assert.equal(afterEdit[0].text, "Bonsoir");
assert.equal(afterEdit[0].is_code, true);
assert.equal(afterEdit[0].edited_at, corrected.edited_at);
assert.equal(afterEdit[0].deliveryStatus, undefined);

console.log("États d’envoi des messages : 11 vérifications réussies.");
