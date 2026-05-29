const API_BASE = "https://showbox-api-1.onrender.com";

/**
 * Get query params from URL
 */
function getParams() {
  const url = new URL(window.location.href);
  return {
    name: url.searchParams.get("name"),
    year: url.searchParams.get("year"),
    type: url.searchParams.get("type") || "movie"
  };
}

/**
 * Main function: resolve movie → direct link
 */
async function resolveMovieFromUrl() {
  const { name, year, type } = getParams();

  if (!name) {
    console.error("Missing movie name in URL (?name=...)");
    return;
  }

  try {
    // 1. Search movie
    const searchRes = await fetch(
      `${API_BASE}/api/search?type=${type}&title=${encodeURIComponent(name)}`
    );
    const searchData = await searchRes.json();

    const results = searchData?.list || searchData || [];
    if (!results.length) {
      console.error("No results found");
      return;
    }

    // 2. Pick best match
    let movie =
      results.find(
        m => year && String(m.year) === String(year)
      ) || results[0];

    const mid = movie.mid || movie.id;
    const mediaType = type === "movie" ? 1 : 2;

    // 3. Get Febbox ID
    const febRes = await fetch(
      `${API_BASE}/api/febbox/id?id=${mid}&type=${mediaType}`
    );
    const febData = await febRes.json();

    if (!febData?.febBoxId) {
      console.error("No Febbox ID");
      return;
    }

    const shareKey = febData.febBoxId;

    // 4. Get files
    const filesRes = await fetch(
      `${API_BASE}/api/febbox/files?shareKey=${shareKey}&parent_id=0`
    );
    const files = await filesRes.json();

    if (!files.length) {
      console.error("No files found");
      return;
    }

    const file = files[0];

    // 5. Get links
    const linksRes = await fetch(
      `${API_BASE}/api/febbox/links?shareKey=${shareKey}&fid=${file.fid}`
    );
    const links = await linksRes.json();

    if (!links.length) {
      console.error("No links found");
      return;
    }

    const finalLink = links[0].url;

    // 6. EXPOSE RESULT GLOBALLY
    window.MOVIE_LINK = {
      title: movie.title,
      year: movie.year,
      link: finalLink
    };

    console.log("Movie Ready:", window.MOVIE_LINK);

    // Optional: trigger event
    window.dispatchEvent(new CustomEvent("movieReady", {
      detail: window.MOVIE_LINK
    }));

  } catch (err) {
    console.error("Error:", err.message);
  }
}

// Auto-run when page loads
window.addEventListener("load", resolveMovieFromUrl);