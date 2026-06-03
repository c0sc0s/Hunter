import assert from "node:assert/strict";
import { contentHtmlFromSnapshot, contentHtmlFromText, sanitizeContentHtml } from "../sources/contentHtml";

const clean = sanitizeContentHtml(`
  <article id="reader" name="reader">
    <h1>Reader content</h1>
    <p style="position:fixed" onclick="alert(1)">Useful paragraph <a href="javascript:alert(1)">bad link</a>.</p>
    <img src="https://example.com/cover.jpg" onerror="alert(1)" />
    <script>alert(1)</script>
    <svg><script>alert(2)</script></svg>
  </article>
`);

assert.ok(clean);
assert.match(clean, /Reader content/);
assert.match(clean, /Useful paragraph/);
assert.match(clean, /https:\/\/example\.com\/cover\.jpg/);
assert.doesNotMatch(clean, /<script/i);
assert.doesNotMatch(clean, /onclick/i);
assert.doesNotMatch(clean, /onerror/i);
assert.doesNotMatch(clean, /javascript:/i);
assert.doesNotMatch(clean, /style=/i);
assert.doesNotMatch(clean, /<svg/i);
assert.match(clean, /id="user-content-reader"/);

const textHtml = contentHtmlFromText(`Selected <private> & "important" passage`);
assert.equal(textHtml, "<p>Selected &lt;private&gt; &amp; &quot;important&quot; passage</p>");

const snapshotHtml = contentHtmlFromSnapshot(
  `<main><h1>Visible Doc</h1><p>Visible browser snapshot content remains available after sanitization.</p></main>`,
  "Visible browser snapshot content remains available after sanitization."
);
assert.match(snapshotHtml ?? "", /Visible Doc/);

const emptyShellHtml = contentHtmlFromSnapshot(
  `<div id="app"></div><script>alert(1)</script>`,
  "Fallback text should become canonical content when the captured HTML is only an empty app shell."
);
assert.equal(emptyShellHtml, "<p>Fallback text should become canonical content when the captured HTML is only an empty app shell.</p>");

console.log("content html fixtures passed");
