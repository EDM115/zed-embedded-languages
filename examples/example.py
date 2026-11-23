def build_export(kind, region="west", tier="gold", status="active"):
    if kind == "balances":
        query = """
            SELECT r.account_id, r.period,
                   REPLACE(TRIM(TRAILING '.' FROM
                       TRIM(TRAILING '0' FROM CAST(CAST(r.balance AS DECIMAL(20, 3)) AS CHAR))
                   ), '.', ',') AS formatted_balance
            FROM (
                SELECT p.account_id, p.period, ROUND(SUM(COALESCE(p.amount, 0)), 3) AS balance
                FROM payments AS p
                INNER JOIN accounts AS a ON a.id = p.account_id
                WHERE a.active = true
                GROUP BY p.account_id, p.period
            ) AS r
            WHERE r.balance > 0
            ORDER BY r.account_id, r.period;
        """
    elif kind == "receipts":
        query = """
            SELECT o.id, o.account_id,
                   CASE WHEN o.amount = 0 THEN '0' ELSE REPLACE(
                       TRIM(TRAILING '.' FROM
                            TRIM(TRAILING '0' FROM CAST(o.amount AS CHAR))), '.', ',')
                   END AS receipt_amount
            FROM orders AS o
            LEFT JOIN accounts AS a ON a.id = o.account_id
            WHERE o.cancelled = false
            ORDER BY o.id;
        """
    else:
        # The companion assembles adjacent literals and consecutive appends
        query = ("SE" "LECT id, display_name "
                 "FROM accounts ")
        query += "WHERE region = '%s' " % region
        query += "AND tier = '{tier}' ".format(tier=tier)
        query += f"AND status = '{status}' "
        query += "ORDER BY id LIMIT 25;"
    return query


recursive_query = """
-- A recursive CTE can still be detected after this comment
/* Generate a tiny date-independent reporting sequence */
WITH RECURSIVE seq(n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM seq WHERE n < 7
)
SELECT n, n * n AS squared
FROM seq
ORDER BY n;
"""
sqlite_query = """
SELECT id, label FROM widgets
WHERE tenant_id = :tenant AND rank >= ?12 AND category = $category
  AND label <> ':this_is_literal ?34 $still_literal';
"""
postgres_query = "SELECT id::text FROM accounts WHERE id = $1;"
server_clock = "SELECT CURRENT_TIMESTAMP;"
computed_value = "SELECT ABS(-42);"

# The hint also works for the first statement in a function
def preview_columns():
    # sql
    projection = "SELECT display_name"
    return projection


def accept_literal(text):
    return text


projection_argument = accept_literal(
    # sql
    "SELECT display_name",
)

# language=xml
explicit_xml = "<configuration><feature enabled='true'/></configuration>"

# Escaped quotes, virtual line breaks, raw strings, and literal f-string braces
escaped_json = "{\n\"display name\": \"Café 🌈\", \"matrix\": [[1], [2]], \"enabled\": true\n}"
raw_json = r'{"message": "line\n", "items": [null, {"weight": 2.5}]}'
name = "Ada"
templated_json = rf'{{"message": "Hello\n{name}", "enabled": true}}'

html = """<!-- summary -->
<h1>Orders & Payments</h1>
<p>Balances by account<p>Amounts rounded to cents"""
html_void = '<source src="summary.mp4" type="video/mp4">'
xml = """<!DOCTYPE report [<!ELEMENT report (#PCDATA)>]>
<report><![CDATA[Summary: <account> & notes]]></report>"""
namespaced_xml = '<r:report xmlns:r="urn:example:report"><r:row /></r:report>'
scss = """$accent: #4b53c4;
$spacing: 1rem;
.card { &:hover { color: $accent } }"""
toml = """[[servers]]
name = "preview"
enabled = true
ports = [8080, 8081]"""
nginx = """server {
    listen 8080;
    server_name example.test;
    location / { root /srv/demo; }
}"""
dockerfile = "# Demo build\nARG BASE=alpine\nFROM ${BASE}:3.19\nCOPY . .\nRUN true"
powershell = "param([string]$Name)\nWrite-Output $Name"

# These controls should stay plain in automatic mode
message = "Select a file from your computer."
placeholder = "<recipient>"
invalid_sql = "SELECT id FROM accounts WHERE id = :account AND ;"
invalid_json = '[[1],]'
