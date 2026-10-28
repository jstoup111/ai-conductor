Waives: skill symlink targets

Rationale: The release classifier flags every `bin/install` edit as the skill-symlink surface. This
first naming spec changes only how the installer obtains each key: it reads the skill's frontmatter
`name:` and falls back to the directory. Every shipped skill still declares the same name as its
directory, so the installed Claude and Codex link names and targets are unchanged. The `ac-` name
flip and its consumer migration are explicitly deferred to the follow-up spec.
