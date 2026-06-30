# Privacy Policy — MusicApp Cookie Sync

MusicApp Cookie Sync has a single purpose: to copy your own YouTube and Google cookies to a self-hosted MusicApp server that you configure, so that media downloads from that server work correctly.

## What we collect

Nothing. The extension does not collect, sell, rent, or share any personal data with the developer or any third party. There is no analytics, no advertising, and no tracking of any kind.

## What the extension does

- Reads the YouTube and Google cookies already stored in your browser for your own account.
- Converts them into a standard Netscape cookies.txt file.
- Uploads that file to the server address you enter (for example, `http://192.168.1.10:8081/api/cookies/upload`).

## Where your data goes

Your cookies are transmitted only to the server URL you type in. They are sent directly from your browser to that server over the connection (HTTP or HTTPS) that you chose. The extension does not send your data anywhere else.

## What the extension stores

The only thing the extension saves is the server address you enter, kept locally in your browser via `chrome.storage.local`. Your cookies are never stored by the extension.

## What the extension does not do

The extension does not modify, read, or inject anything into the websites you visit. It does not change page content, display advertisements, or interact with any third-party services.
