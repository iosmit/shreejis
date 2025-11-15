#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the commit message
if [ "$1" == "" ]; then
    echo "Please provide a commit message"
    echo "Usage: ./deploy.sh \"Your commit message\""
    exit 1
fi

# Navigate to project root
cd "$(dirname "$0")"

echo -e "${BLUE}📦 Staging changes...${NC}"
git add .

echo -e "${BLUE}💬 Committing changes...${NC}"
git commit -m "$1"

echo -e "${BLUE}🚀 Pushing to GitHub...${NC}"
git push

echo -e "${GREEN}✅ Changes pushed to GitHub successfully!${NC}"
echo -e "${BLUE}🔄 Cloudflare Pages deployment will start automatically${NC}"
echo -e "${BLUE}📊 Check deployment status at: https://dash.cloudflare.com/pages${NC}"

