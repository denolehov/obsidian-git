---
aliases:
    - "01 Start here"
---

# Git plugin Documentation

## Topics

-   [[Installation|Installation]]
-   [[Getting Started|Getting Started]]
-   [[Authentication|Authentication]]
-   [[Integration with other tools]]
-   [[Features|Features]]
-   [[Tips-and-Tricks|Tips-and-Tricks]]
-   [[Common issues|Common Issues]]
-   [[Line Authoring|Line Authoring]]
-   [[Styling|Styling]]

> [!warning] Obsidian installation on Linux
> Please don't use Flatpak or Snap to install Obsidian on Linux. Learn more [[Installation#Linux|here]]

![[Getting Started#Performance on mobile]]

## What is Git?

Git is a version control system. It allows you to keep track of changes to your notes and revert back to previous versions. It also allows you to collaborate with other people on the same files. You can read more about Git [here](https://git-scm.com/book/en/v2/Getting-Started-About-Version-Control).

> [!info] Git/GitHub is not a syncing service!
> Git is not meant to share your changes live to the cloud or another person. Meaning it should not be used to work with someone live on the same note. However, it's perfect for async collaboration.

You build your history by batching multiple changes into commits. These can then be reverted or checked out. You can view the difference between version of a note via the [Version History Diff](obsidian://show-plugin?id=obsidian-version-history-diff) plugin.
Git itself only manages a local repository. It becomes really handy in conjunction with an online remote repository. You can push and pull your commits to/from a remote repository to share or backup your vault. The most popular provider is [GitHub](https://github.com).

Git is primarily used by developers and thus the command line is sometimes needed. Obsidian-Git is a plugin for Obsidian that allows you to use Git from within Obsidian without always having to use the command line or leaving Obsidian.

## Terminology and concepts

### Backup - no longer in use

For simplification, the term "Backup" refers to staging everything -> committing -> pulling -> pushing.

### Sync

Syncing is the process of pulling and pushing changes to and from a remote repository. This is done to keep your local repository up to date with the remote repository on e.g. GitHub.

### Commit-and-sync

Commit-and-sync is the process of staging everything -> committing -> pulling -> pushing. Ideally this is a single action that you do regularly to keep your local and remote repository in sync. It's recommended you set it up from the plugin's settings to be run automatically every X minutes. You can also disable the pulling or pushing part from the "Commit-and-sync" section in the plugin's settings. This reduces the "commit-and-sync" action to either a "commit and pull", "commit and push" or just commit action.
