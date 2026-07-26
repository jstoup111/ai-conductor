# Track: parallel validation, serial fenced publication (#922)

Track: technical

The concurrent SHIP validation group joins before a serial rebase/finish tail, and an engine-owned
current-HEAD fence prevents every finish entry path from publishing over non-green validation.
