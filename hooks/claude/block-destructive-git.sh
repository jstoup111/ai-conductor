#!/bin/bash
# Block destructive git operations: force push, hard reset, branch delete.
set -e
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")
VERDICT=$(COMMAND="$COMMAND" python3 - <<'PY'
import json, os, re, shlex
# BEGIN GIT_OPTION_SPEC
SPEC = json.loads(r'''{"global":[{"name":"version","short":"v","arity":"none","acceptsEquals":false},{"name":"help","short":"h","arity":"none","acceptsEquals":false},{"short":"C","arity":"required","acceptsEquals":false},{"short":"c","arity":"required","acceptsEquals":false},{"name":"exec-path","arity":"none","acceptsEquals":true},{"name":"html-path","arity":"none","acceptsEquals":false},{"name":"man-path","arity":"none","acceptsEquals":false},{"name":"info-path","arity":"none","acceptsEquals":false},{"name":"paginate","short":"p","arity":"none","acceptsEquals":false},{"name":"no-pager","short":"P","arity":"none","acceptsEquals":false},{"name":"no-replace-objects","arity":"none","acceptsEquals":false},{"name":"no-lazy-fetch","arity":"none","acceptsEquals":false},{"name":"no-optional-locks","arity":"none","acceptsEquals":false},{"name":"no-advice","arity":"none","acceptsEquals":false},{"name":"bare","arity":"none","acceptsEquals":false},{"name":"git-dir","arity":"required","acceptsEquals":true},{"name":"work-tree","arity":"required","acceptsEquals":true},{"name":"namespace","arity":"required","acceptsEquals":true},{"name":"config-env","arity":"required","acceptsEquals":true}],"subcommands":{"reset":[{"name":"quiet","short":"q","arity":"none","negatable":true},{"name":"no-refresh","arity":"none","negatable":false},{"name":"refresh","arity":"none","negatable":false},{"name":"mixed","arity":"none","negatable":false},{"name":"soft","arity":"none","negatable":false},{"name":"hard","arity":"none","negatable":false},{"name":"merge","arity":"none","negatable":false},{"name":"keep","arity":"none","negatable":false},{"name":"recurse-submodules","arity":"optional","negatable":true},{"name":"patch","short":"p","arity":"none","negatable":true},{"name":"unified","short":"U","arity":"required","negatable":true},{"name":"inter-hunk-context","arity":"required","negatable":true},{"name":"intent-to-add","short":"N","arity":"none","negatable":true},{"name":"pathspec-from-file","arity":"required","negatable":true},{"name":"pathspec-file-nul","arity":"none","negatable":true}],"branch":[{"name":"verbose","short":"v","arity":"none","negatable":true},{"name":"quiet","short":"q","arity":"none","negatable":true},{"name":"track","short":"t","arity":"optional","negatable":true},{"name":"set-upstream-to","short":"u","arity":"required","negatable":true},{"name":"unset-upstream","arity":"none","negatable":true},{"name":"color","arity":"optional","negatable":true},{"name":"remotes","short":"r","arity":"none","negatable":true},{"name":"contains","arity":"required","negatable":true},{"name":"abbrev","arity":"optional","negatable":true},{"name":"all","short":"a","arity":"none","negatable":true},{"name":"delete","short":"d","arity":"none","negatable":true},{"short":"D","arity":"none","negatable":false,"expandsTo":["delete","force"]},{"name":"move","short":"m","arity":"none","negatable":true},{"short":"M","arity":"none","negatable":false,"expandsTo":["move","force"]},{"name":"omit-empty","arity":"none","negatable":true},{"name":"copy","short":"c","arity":"none","negatable":true},{"short":"C","arity":"none","negatable":false,"expandsTo":["copy","force"]},{"name":"list","short":"l","arity":"none","negatable":true},{"name":"show-current","arity":"none","negatable":true},{"name":"create-reflog","arity":"none","negatable":true},{"name":"edit-description","arity":"none","negatable":true},{"name":"force","short":"f","arity":"none","negatable":true},{"name":"merged","arity":"required","negatable":true},{"name":"column","arity":"optional","negatable":true},{"name":"sort","arity":"required","negatable":true},{"name":"points-at","arity":"required","negatable":true},{"name":"ignore-case","short":"i","arity":"none","negatable":true},{"name":"recurse-submodules","arity":"none","negatable":true},{"name":"format","arity":"required","negatable":true}],"clean":[{"name":"quiet","short":"q","arity":"none","negatable":true},{"name":"dry-run","short":"n","arity":"none","negatable":true},{"name":"interactive","short":"i","arity":"none","negatable":true},{"name":"exclude","short":"e","arity":"required","negatable":true},{"name":"force","short":"f","arity":"none","negatable":true},{"short":"d","arity":"none","negatable":false},{"short":"x","arity":"none","negatable":false},{"short":"X","arity":"none","negatable":false}],"push":[{"name":"verbose","short":"v","arity":"none","negatable":true},{"name":"quiet","short":"q","arity":"none","negatable":true},{"name":"repo","arity":"required","negatable":true},{"name":"all","arity":"none","negatable":true},{"name":"branches","arity":"none","negatable":false},{"name":"mirror","arity":"none","negatable":true},{"name":"delete","short":"d","arity":"none","negatable":true},{"name":"tags","arity":"none","negatable":true},{"name":"dry-run","short":"n","arity":"none","negatable":true},{"name":"porcelain","arity":"none","negatable":true},{"name":"force","short":"f","arity":"none","negatable":true},{"name":"force-with-lease","arity":"optional","negatable":true},{"name":"force-if-includes","arity":"none","negatable":true},{"name":"recurse-submodules","arity":"optional","negatable":true},{"name":"thin","arity":"none","negatable":true},{"name":"receive-pack","arity":"required","negatable":true},{"name":"exec","arity":"required","negatable":true},{"name":"set-upstream","short":"u","arity":"none","negatable":true},{"name":"progress","arity":"none","negatable":true},{"name":"prune","arity":"none","negatable":true},{"name":"verify","arity":"none","negatable":true},{"name":"follow-tags","arity":"none","negatable":true},{"name":"signed","arity":"optional","negatable":true},{"name":"atomic","arity":"none","negatable":true},{"name":"push-option","short":"o","arity":"required","negatable":true},{"name":"ipv4","short":"4","arity":"none","negatable":true},{"name":"ipv6","short":"6","arity":"none","negatable":true}],"checkout":[{"name":"branch","short":"b","arity":"required","negatable":true},{"name":"orphan","arity":"required","negatable":true},{"name":"guess","arity":"none","negatable":true},{"name":"overlay","arity":"none","negatable":true},{"name":"quiet","short":"q","arity":"none","negatable":true},{"name":"recurse-submodules","arity":"optional","negatable":true},{"name":"progress","arity":"none","negatable":true},{"name":"merge","short":"m","arity":"none","negatable":true},{"name":"conflict","arity":"required","negatable":true},{"name":"detach","short":"d","arity":"none","negatable":true},{"name":"track","short":"t","arity":"optional","negatable":true},{"name":"force","short":"f","arity":"none","negatable":true},{"name":"overwrite-ignore","arity":"none","negatable":true},{"name":"ignore-other-worktrees","arity":"none","negatable":true},{"name":"ours","short":"2","arity":"none","negatable":true},{"name":"theirs","short":"3","arity":"none","negatable":true},{"name":"patch","short":"p","arity":"none","negatable":true},{"name":"unified","short":"U","arity":"required","negatable":true},{"name":"inter-hunk-context","arity":"required","negatable":true},{"name":"ignore-skip-worktree-bits","arity":"none","negatable":true},{"name":"pathspec-from-file","arity":"required","negatable":true},{"name":"pathspec-file-nul","arity":"none","negatable":true},{"short":"B","arity":"required","negatable":false},{"short":"l","arity":"none","negatable":false}],"restore":[{"name":"source","short":"s","arity":"required","negatable":true},{"name":"staged","short":"S","arity":"none","negatable":true},{"name":"worktree","short":"W","arity":"none","negatable":true},{"name":"ignore-unmerged","arity":"none","negatable":true},{"name":"overlay","arity":"none","negatable":true},{"name":"quiet","short":"q","arity":"none","negatable":true},{"name":"recurse-submodules","arity":"optional","negatable":true},{"name":"progress","arity":"none","negatable":true},{"name":"merge","short":"m","arity":"none","negatable":true},{"name":"conflict","arity":"required","negatable":true},{"name":"ours","short":"2","arity":"none","negatable":true},{"name":"theirs","short":"3","arity":"none","negatable":true},{"name":"patch","short":"p","arity":"none","negatable":true},{"name":"unified","short":"U","arity":"required","negatable":true},{"name":"inter-hunk-context","arity":"required","negatable":true},{"name":"ignore-skip-worktree-bits","arity":"none","negatable":true},{"name":"pathspec-from-file","arity":"required","negatable":true},{"name":"pathspec-file-nul","arity":"none","negatable":true}]}}''')
# END GIT_OPTION_SPEC
HEREDOC=re.compile(r'(?<!<)<<(?P<s>-?)(?!<)[ \t]*(?P<w>(?:\\.|\'[^\']*\'|"[^"]*"|[^\s;|&<])+)' )
def comment(line):
 q=None; esc=False
 for i,c in enumerate(line):
  if esc: esc=False
  elif c=="\\" and q!="'": esc=True
  elif q:
   if c==q:q=None
  elif c in "'\"":q=c
  elif c=="#" and (i==0 or line[i-1].isspace() or line[i-1] in ";|&"):return i
 return len(line)
def scan(text):
 out=[]; ds=[]; arithmetic=0
 for line in text.splitlines(keepends=True):
  if ds:
   x=line.rstrip("\n"); d,t=ds[0]; x=x.lstrip("\t") if t else x
   if x==d:ds.pop(0)
   continue
  n=comment(line); visible=line[:n]+" "*(len(line)-n)
  for m in HEREDOC.finditer(visible):
   if arithmetic or visible[:m.start()].count("'") % 2 or visible[:m.start()].count('"') % 2 or visible[:m.start()].count('((') > visible[:m.start()].count('))'): continue
   d=re.sub(r'''\\(.)|['"]''',lambda x:x.group(1) or "",m.group("w")).rstrip()
   ds.append((d,m.group("s")=="-"))
  arithmetic += visible.count('((') - visible.count('))')
  out.append(visible.rstrip("\n")+";\n")
 return "".join(out)
def commands(text):
 l=shlex.shlex(text,posix=True,punctuation_chars=True);l.whitespace_split=True;l.commenters=""
 a=[]
 for x in l:
  if x in (";","|","&","&&","||"):
   if a:yield a
   a=[]
  else:a.append(x)
 if a:yield a
def find(opts,t):
 if t.startswith("--"):
  x=t[2:].split("=",1)[0]; z=[o for o in opts if o.get("name")==x] or [o for o in opts if o.get("name","").startswith(x)]
  return z[0] if len(z)==1 else None
 return next((o for o in opts if o.get("short")==t[1:]),None)
def norm(a):
 i=1
 while i<len(a) and a[i].startswith("-"):
  o=find(SPEC["global"],a[i])
  if not o:break
  if o["arity"]=="required" and "=" not in a[i]:
   i+=1
   if i==len(a):return None
  i+=1
 if i==len(a):return None
 c=a[i]
 if c not in SPEC["subcommands"]:return c,[],[]
 op=[]; args=[];i+=1
 while i<len(a):
  x=a[i]
  if x=="--":args+=a[i+1:];break
  if x.startswith("-") and x!="-":
   if x.startswith("--"):
    o=find(SPEC["subcommands"][c],x)
    if not o:return None
    op+=o.get("expandsTo",[o.get("name")])
    if o["arity"]=="required" and "=" not in x:
     i+=1
     if i==len(a):return None
    elif o["arity"]=="optional" and "=" not in x and i+1<len(a) and not a[i+1].startswith("-"):i+=1
   else:
    for s in x[1:]:
     o=find(SPEC["subcommands"][c],"-"+s)
     if not o or o["arity"]!="none":return None
     op+=o.get("expandsTo",[o.get("name")])
  else:args.append(x)
  i+=1
 return c,op,args
def verdict(a):
 if len(a)>1 and a[1]=="rebase" and not any(v in ("--continue","--abort","--skip","--edit-todo","--quit") for v in a[2:]):return "rebase-note"
 x=norm(a)
 if not x:return None
 c,o,args=x
 if c=="push" and ("force" in o or any(v.startswith("+") for v in args)):return "deny force-push"
 if c=="reset" and "hard" in o:return "deny reset-hard"
 if c=="clean" and "force" in o:return "deny clean-force"
 if c=="branch" and "delete" in o and "force" in o:return "branch-delete "+json.dumps(args)
 if c=="checkout" and args==["."]:return "deny checkout"
 if c=="restore" and args==["."]:return "deny restore"
for words in commands(scan(os.environ.get("COMMAND",""))):
 for i,w in enumerate(words):
  if w=="git" or w.endswith("/git"):
   v=verdict(words[i:])
   if v:print(v);raise SystemExit
print("allow")
PY
)
case "$VERDICT" in
 'deny force-push') echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Force push blocked by harness. Use --force-with-lease instead, or ask the user for explicit confirmation."}}' >&2;exit 2;;
 'deny reset-hard') echo "BLOCKED: git reset --hard is destructive and irreversible. Investigate the issue or ask the user before discarding work." >&2;exit 2;;
 'deny clean-force') echo "BLOCKED: git clean -f permanently removes untracked files. Ask the user before cleaning." >&2;exit 2;;
 'deny checkout'|'deny restore') echo "BLOCKED: This discards all unstaged changes. Ask the user before reverting." >&2;exit 2;;
 rebase-note) echo "NOTE: 'git rebase' is allowed but should be rare — only the daemon finish-time rebase-on-latest and the /rebase resolver rebase feature branches; never rebase mid-build (HARNESS.md → Rebase Policy). Proceeding." >&2;;
 branch-delete\ *) branches=${VERDICT#branch-delete };default=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed -E 's@^refs/remotes/origin/@@' || true);[ -z "$default" ]&&default=$(git rev-parse --abbrev-ref HEAD 2>/dev/null||echo main);unsafe="";while IFS= read -r b;do git merge-base --is-ancestor "$b" "$default" 2>/dev/null&&continue;command -v gh >/dev/null 2>&1&&[ -n "$(gh pr list --head "$b" --state merged --json number --jq '.[0].number' 2>/dev/null||true)" ]&&continue;unsafe="$unsafe $b";done < <(BRANCHES="$branches" python3 -c 'import json, os; print(*json.loads(os.environ["BRANCHES"]), sep="\\n")');if [ -n "$unsafe" ];then echo "BLOCKED: git branch -D would force-delete UNMERGED branch(es):$unsafe. Use -d for a safe delete, or ask the user. (Merged or squash/rebase-merged branches are allowed for cleanup.)" >&2;exit 2;fi;;
esac
exit 0
