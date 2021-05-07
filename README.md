# Obsidian Git
Simple plugin that allows you to backup your [Obsidian.md](https://obsidian.md) vault to a remote git repository (e.g. private repo on GitHub).
This plugin assumes credentials are set up.

On advantages of backing up your vault with git I suggest reading this [amazing article](https://medium.com/analytics-vidhya/how-i-put-my-mind-under-version-control-24caea37b8a5) by [@tallguyjenks](https://github.com/tallguyjenks).

## How to use

For mobile use please refer to the [obsidian-git-mobile](https://github.com/Vinzent03/obsidian-git-mobile) plugin. It's the same plugin, just with some tweaks to fix node APIs imports.

### Requirements
- credentials are set up
- remote repository

[How to create a repo on GitHub](https://docs.github.com/en/github/getting-started-with-github/create-a-repo)

### Features

- Automatic vault backup every X minutes
- Pull changes from remote repository on Obsidian startup
- Assign hotkeys for pulling/pushing changes to a remote repository

**Note:** it is recommended to exclude obsidian workspace cache files from the repository 
(or even whole `.obsidian` directory) due to potential noise in the git history.

If you'd like to do that, scroll to the bottom for a short guide.

## Compatibility
Custom plugins are only available for Obsidian v0.9.7+.

# Installation
## From within Obsidian
If you have Obsidian 0.9.8+, you can install this plugin from "Settings > Third Party Plugins > Obsidian Git".

## Manual installation
Download zip archive from [GitHub releases page](https://github.com/denolehov/obsidian-git/releases).
Extract the archive into `<vault>/.obsidian/plugins`.

Alternatively, using bash:
```bash
OBSIDIAN_VAULT_DIR=/path/to/your/obsidian/vault
mkdir -p $OBSIDIAN_VAULT_DIR/.obsidian/plugins
unzip ~/Downloads/obsidian-git_v1.1.0.zip -d $OBSIDIAN_VAULT_DIR/.obsidian/plugins
```

## SSH Authentication
> This is a typical example of a trade-off between security and convenience. [...] The most appropriate solution depends on the usage scenario and desired level of security.

If you want to use SSH and have a passphrase for your ssh-key, you have to add it to the ssh-agent so that Obsidian can access it. Read more at this [summary](https://unix.stackexchange.com/questions/90853/how-can-i-run-ssh-add-automatically-without-a-password-prompt/90869#90869) to start `ssh-agent` on system startup.

## Windows installation
Make sure you have `3rd-party software` access enabled.

<img
    src = https://raw.githubusercontent.com/denolehov/obsidian-git/master/windows-installation.png
    width = 400>

**For additional advice on using Obsidian Git for the tech unfamiliar take a look at `foreveryone#6438`'s great [tutorial](https://github.com/gitobsidiantutorial/obsidian-git-tut-windows/blob/main/README.md)**

## Linux installation
Some users reported issues with Obsidian installed via Snap, because Obsidian runs in a kind of sandbox and can't access git.

Installation via [Flatpak](https://flathub.org/apps/details/md.obsidian.Obsidian) or AppImage works.

If you installed Obsidian a while ago via Flatpak, and it doesn't work please run the following.

```
$ flatpak update md.obsidian.Obsidian
$ flatpak override --reset md.obsidian.Obsidian
$ flatpak run md.obsidian.Obsidian
```
https://github.com/flathub/md.obsidian.Obsidian/issues/5#issuecomment-736974662

## Standalone mode

I am using [isomorphic-git](https://isomorphic-git.org/), which is a re-implementation of git in JavaScript, because you cannot use native git on Android or iOS. This brings some problems with it though.
- Merging with conflicts is not supported ([isomorphic-git issue](https://github.com/isomorphic-git/isomorphic-git/issues/325))
- SSH authentication is not supported ([isomorphic-git issue](https://github.com/isomorphic-git/isomorphic-git/issues/231)
- Instead of using native modules, it uses web APIs, why it's affected by [CORS](https://developer.mozilla.org/de/docs/Web/HTTP/CORS) ([isomorphic-git explanation](https://github.com/isomorphic-git/isomorphic-git#cors-support))

The Obsidian devs implemented a workaround for themselves, but didn't expose it to the API so far. Until they improve and expose it, a CORS [proxy server](https://en.wikipedia.org/wiki/Proxy_server) is needed. 

A proxy provided by [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git#cors-support) itself is https://cors.isomorphic-git.org, but please follow their [Terms of Use](https://cors.isomorphic-git.org)


# Tips
## Excluding Obsidian cache files from repository
To exclude cache files from the repository, create `.gitignore` file in the root of your vault and add the following lines:
```
# to exclude Obsidian workspace settings (including plugin and hotkey configurations)
.obsidian/  
# OR only to exclude workspace cache
.obsidian/workspace 

# Add below lines to exclude OS settings and caches
.trash/
.DS_Store
```
---

If you have any kind of feedback or questions, feel free to reach out via GitHub issues or `@evrwhr` or `@Vinadon` on [Obsidian Discord server](https://discord.com/invite/veuWUTm).

This plugin was initial developed by [denolehov](https://github.com/denolehov). Since March, it's mainly [Vinzent03](https://github.com/Vinzent03) who is developing on this plugin.

> If you want to support me ([Vinzent03](https://github.com/Vinzent03)) you can consider [buying me a coffee](https://www.buymeacoffee.com/Vinzent03).

<br>

<a href="https://www.buymeacoffee.com/Vinzent03"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=Vinzent03&button_colour=5F7FFF&font_colour=ffffff&font_family=Inter&outline_colour=000000&coffee_colour=FFDD00"></a>
