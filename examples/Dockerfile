FROM alpine:3.19

ENV REPORT_QUERY="WITH active_accounts AS (SELECT id FROM accounts WHERE active = true) SELECT id FROM active_accounts;"
ENV LOOKUP_QUERY="SELECT id, label FROM widgets WHERE tenant_id = :tenant AND rank >= ?12;"
ENV REPORT_PREVIEW="<h1>Orders & Payments</h1><p>Review the totals</p>"

CMD ["printf", "%s\n", "Open this Dockerfile in Zed to view the embedded highlights."]
