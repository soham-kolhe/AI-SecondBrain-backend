/**
 * YouTube Search Service
 * Searches YouTube for educational concept videos and returns titles and URLs.
 */
async function searchYouTube(query) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " educational tutorial")}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!response.ok) {
      throw new Error(`YouTube request failed with status: ${response.status}`);
    }

    const html = await response.text();
    const regex = /ytInitialData\s*=\s*({.+?});/;
    const match = html.match(regex);

    if (match) {
      const json = JSON.parse(match[1]);
      const contents = json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
      
      if (contents && Array.isArray(contents)) {
        const videos = [];
        for (const item of contents) {
          const videoRenderer = item.videoRenderer;
          if (videoRenderer && videoRenderer.videoId && videoRenderer.title?.runs?.[0]?.text) {
            const title = videoRenderer.title.runs[0].text;
            videos.push({
              title,
              url: `https://www.youtube.com/watch?v=${videoRenderer.videoId}`
            });
            if (videos.length >= 3) break;
          }
        }
        if (videos.length > 0) return videos;
      }
    }
    throw new Error("Could not parse ytInitialData from YouTube HTML");
  } catch (err) {
    console.error("YouTube scraper failed, using fallback:", err.message);
    // Safe fallback if YouTube blocks the server IP
    return [
      {
        title: `YouTube Search: ${query}`,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      }
    ];
  }
}

module.exports = { searchYouTube };
