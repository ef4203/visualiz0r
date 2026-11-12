/** @type {import("puppeteer").Configuration} */
module.exports = {
  // Chrome is only needed for `npm run docs:screenshots`, which downloads it on first use.
  skipDownload: true,
}
