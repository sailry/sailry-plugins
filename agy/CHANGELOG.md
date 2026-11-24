# Changes

## 0.1.4

- One agy process serves up to eight requests at once, each conversation in its own agy session; parallel delegations beyond that wait instead of failing.

## 0.1.3

- Resume the agy session after a restart and compact it with /compact where offered; compaction follows the model’s context window.

## 0.1.2

- Group reported xhigh variants under their model’s reasoning levels.

## 0.1.1

- Ask to accept the account risk before adding the channel

## 0.1.0

- Use Antigravity models through the installed, signed-in agy CLI
