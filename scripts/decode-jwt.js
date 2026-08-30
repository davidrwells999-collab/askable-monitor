// Decode a JWT and print its payload — used to pull `askable_user_id` out of an
// Askable access token when bootstrapping a new user.
//   node scripts/decode-jwt.js "eyJ..."
const token = process.argv[2];
if (!token) {
  console.error('Usage: node scripts/decode-jwt.js "<jwt>"');
  process.exit(1);
}
const part = token.split(".")[1];
if (!part) {
  console.error("That doesn't look like a JWT (no payload segment).");
  process.exit(1);
}
const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
console.log(JSON.stringify(payload, null, 2));
console.log("\naskable_user_id:", payload.askable_user_id ?? "(not present)");
