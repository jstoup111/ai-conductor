# Intake origin: destructive-git-guard-parser-misses-valid-git-and-

Source-Ref: jstoup111/ai-conductor#2904
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2904 digest=55b850e21868902759d5e4ca9416d6df4ff330a23dfeb47eac95da050d0577f5 >>>
## Desired outcome

- Git global options, alias expansion, and target-repository prefixes are parsed the way git itself parses them, proven by a table-driven test over git's documented option forms
- Heredoc and comment handling follows bash quote removal rules, with a corpus test in which every listed spelling is still refused
<<< END INBOUND >>>
