package main

import "fmt"

func main() {
	tenant := 42
	query := fmt.Sprintf("SELECT account_id, SUM(amount) AS total FROM invoices WHERE tenant_id = %d ", tenant)
	query += "GROUP BY account_id "
	query += "ORDER BY total DESC;"

	report := `-- Printable without a database connection
WITH active_accounts AS (
    SELECT id FROM accounts WHERE active = true
)
SELECT id FROM active_accounts;`
	escapes := "{\n\"matrix\": [[1], [2]], \"visible\": true\n}"
	page := `<!-- report --><h1>Orders & Payments</h1><p>Review the totals</p>`
	xml := `<r:report xmlns:r="urn:example:report"><r:row /></r:report>`

	fmt.Println(query, report, escapes, page, xml)
}
