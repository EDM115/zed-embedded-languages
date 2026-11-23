#!/usr/bin/env bash

report='-- Show daily totals
WITH active_accounts AS (
    SELECT id FROM accounts WHERE active = true
)
SELECT a.id, COUNT(o.id) AS total
FROM active_accounts AS a
LEFT JOIN orders AS o ON a.id = o.account_id
WHERE a.id = :account
GROUP BY a.id;'

payload='{"matrix": [[1], [2]], "visible": true, "items": [null, {"id": 3}]}'
page='<h1>Accounts & Orders</h1><p>Review the totals</p>'
dockerfile='FROM alpine:3.19
WORKDIR /demo
RUN true'

# language=sql
projection='SELECT account_id'

printf '%s\n' "$report" "$payload" "$page" "$dockerfile" "$projection"
