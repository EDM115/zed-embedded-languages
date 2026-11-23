<?php

$query = "SELECT account_id, SUM(amount) AS total "
       . "FROM invoices ";
$query .= "WHERE tenant_id = :tenant ";
$query .= "GROUP BY account_id ORDER BY total DESC;";

$report = 'SELECT id, CASE WHEN amount = 0 THEN 0 ELSE amount END AS total FROM invoices;';
$payload = '{"matrix": [[1], [2]], "status": "active", "empty": null}';
$markup = '<!-- account report --><h1>Orders & Payments</h1><p>Review the totals</p>';
$xml = '<r:report xmlns:r="urn:example:report"><r:row /></r:report>';

// language=sql
$projection = 'SELECT account_id';

echo implode(PHP_EOL, [$query, $report, $payload, $markup, $xml, $projection]), PHP_EOL;
