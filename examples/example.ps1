$Query = 'SELECT account_id, SUM(amount) AS total
FROM invoices
WHERE tenant_id = :tenant AND rank >= ?12
GROUP BY account_id;'

$Report = 'WITH RECURSIVE seq(n) AS (
    SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 4
) SELECT n FROM seq;'

$Payload = '{"matrix": [[1], [2]], "visible": true, "items": [null, {"id": 3}]}'
$Xml = '<r:report xmlns:r="urn:example:report"><r:row /></r:report>'
$Script = 'param([string]$Name)
Write-Output $Name'

# language=sql
$Projection = 'SELECT account_id'

$Query, $Report, $Payload, $Xml, $Script, $Projection
