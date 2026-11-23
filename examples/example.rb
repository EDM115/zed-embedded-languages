query = 'SELECT account_id, SUM(amount) AS total FROM invoices WHERE tenant_id = :tenant GROUP BY account_id;'
report = 'WITH active_accounts AS (SELECT id FROM accounts WHERE active = true) SELECT id FROM active_accounts;'
payload = '{"matrix": [[1], [2]], "visible": true, "items": [null, {"count": 3}]}'
page = '<section><h1>Orders & Payments</h1><p>Review the totals</p></section>'
xml = '<r:report xmlns:r="urn:example:report"><r:row /></r:report>'

# language=sql
projection = 'SELECT account_id'

puts query, report, payload, page, xml, projection
