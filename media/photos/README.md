# Photos

The paper's photo library. Masters are kept here at full size, each named for what it
shows: `<event>-<what is in it>.jpg`, lowercase, words joined by dashes, and never people's
names. The site never loads these directly; it uses the smaller copies in `public/photos/`,
which the build publishes at `/photos/...` (on Vercel too).

## Adding a photo

1. Save it here as `<event>-<what is in it>.jpg`, for example `diwali-2026-lamp-lighting.jpg`.
2. Run `python3 tools/prepare-photos.py`. It writes `public/photos/<name>-600.jpg` and
   `<name>-1200.jpg`, and only needs Pillow.
3. Use it in a page with both sizes and a description for people who can't see it:

   ```html
   <figure class="photo photo--wide">
     <img src="/photos/<name>-1200.jpg"
          srcset="/photos/<name>-600.jpg 600w, /photos/<name>-1200.jpg 1200w"
          sizes="(min-width: 720px) 640px, 100vw" width="1200" height="900"
          loading="lazy" decoding="async" alt="What the photo shows, in a sentence.">
     <figcaption>A line a reader would want to know.</figcaption>
   </figure>
   ```

   Use `photo--wide` for a big picture with its caption alongside, or `photo--aside` for a
   smaller one set to the side of the text. `width` and `height` are the 1200 copy's size.

Ask before putting someone's photo on the public paper, and leave out pictures where
campaign or political material is prominent: on a nonprofit's site it can read as an
endorsement.

## The lakeside summer picnic

| File | What it shows | On the site |
|---|---|---|
| `lakeside-picnic-jeevan-jyoti-banner.jpg` | The red and white "Jeevan Jyoti Inc." banner over members at the tables | About page, top |
| `lakeside-picnic-certificate-presentation.jpg` | A guest at the microphone; members holding the framed certificate | About page, With Thanks |
| `lakeside-picnic-tables-under-the-pavilion.jpg` | Members at red-covered tables playing bingo, the lake behind | Front page, editor's note |
| `lakeside-picnic-bingo-cards.jpg` | Members filling in bingo cards at a table | Not yet |
| `lakeside-picnic-certificate-speech.jpg` | A member speaking while the certificate is presented | Not yet |
| `lakeside-picnic-conversation.jpg` | Members in conversation with guests | Not yet |
| `lakeside-picnic-group-by-the-lake.jpg` | Five people in the sun by the lake | Not yet (a campaign shirt shows behind) |
| `lakeside-picnic-certificate-of-merit-group.jpg` | Five people holding the Certificate of Merit | Not yet (a campaign shirt in the middle) |
| `lakeside-picnic-bingo-table-group.jpg` | The bingo hosts with the cage and board, guests behind | Not yet (a campaign shirt shows) |
