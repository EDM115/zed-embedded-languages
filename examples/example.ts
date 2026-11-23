type Report = "totals" | "summary";

function reportQuery(mode: Report, tenantId: number): string {
    if (mode === "totals") {
        let statement = "SELECT account_id, SUM(amount) AS total ";
        statement += "FROM invoices ";
        statement += `WHERE tenant_id = ${tenantId} `;
        statement += "GROUP BY account_id ORDER BY total DESC;";
        return statement;
    }

    return `WITH active_accounts AS (
        SELECT id, name FROM accounts WHERE active = true
    )
    SELECT a.id, a.name
    FROM active_accounts AS a
    WHERE a.id = ${tenantId};`;
}

const sample = reportQuery("totals", 42);
const xml = "<?xml version=\"1.0\"?><report id=\"totals\"><row /></report>";
const config = `[[workers]]
enabled = true
ports = [8080, 8081]`;
const payload = '{"active": true, "matrix": [[1], [2]], "items": [null, {"id": 5}]}';

// language=sql
const projection = "SELECT account_id";

const message = "Select a report from the list.";
