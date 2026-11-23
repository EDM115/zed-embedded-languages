const tenant = 42;
let query = "SELECT account_id, COUNT(*) AS order_count ";
query += "FROM orders ";
query += `WHERE tenant_id = ${tenant} `;
query += "GROUP BY account_id ORDER BY order_count DESC;";

const cookedJson = "{\n\"matrix\": [[1], [2]], \"caption\": \"Café 🌈\", \"visible\": true\n}";
const rawJson = String.raw`{"message": "first\nsecond", "rows": [null, {"count": 2}]}`;
const emailField = "<input type=\"email\" autocomplete=\"email\" />";
const heading = "Monthly report";
const html = `<!-- section --><h1>${heading}</h1><p>Sales & returns</p>`;

// language=sql
const projection = "SELECT account_id";

const ordinary = "Select an account from the list.";
