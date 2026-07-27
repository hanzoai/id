# @hanzo/id-account

The account portal: branded account-management pages at `account.hanzo.id`,
`account.lux.id`, … served by a Cloudflare Worker, authenticated with IAM access
tokens over the OAuth code exchange.

It lives HERE, in `hanzoai/id`, because it is identity UI — the same brands, the
same IAM, the same login redirect as `apps/web`. It used to live in
`hanzoai/account`, which is a Go module: one repo held two unrelated codebases
under one name (`main` was this Worker, the Go module survived only on a `go`
branch and its tags). That collision is what made
`github.com/hanzoai/account` unresolvable as a Go module from a clean checkout.

`hanzoai/account` is now the Go module and nothing else — see its README for the
billing-account rule it owns.
