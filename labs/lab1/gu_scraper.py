import requests
from bs4 import BeautifulSoup

with open("urls.txt", "r", encoding="utf-8") as f:
    urls = [line.strip() for line in f if line.strip()]

for ix, url in enumerate(urls):
    response = requests.get(url)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    main = soup.find_all("div", "formatted-content")
    title = soup.title.string.split(" | ")[0]

    if main:
        text = "\n\n\n".join([section.get_text("\n", strip=True) for section in main])
        with open(f"pages/page-{ix:03}-{title}.txt", "w", encoding="utf-8") as f:
            f.write(text)
