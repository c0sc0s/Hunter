import assert from "node:assert/strict";
import { openConnectorSecret, sealConnectorSecret } from "../connectorSecretBox";

process.env.HUNTTER_CONNECTOR_SECRET_KEY = "connector-secret-test-key";

const token = "u-test-access-token";
const sealed = sealConnectorSecret(token);

assert.notEqual(sealed, token);
assert.equal(sealed.includes(token), false);
assert.match(sealed, /^v1\./);
assert.equal(openConnectorSecret(sealed), token);
assert.notEqual(sealConnectorSecret(token), sealed);

console.log("connector secret box fixtures passed");
