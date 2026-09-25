for file in ../labs/lab1/data/*.txt; do
  npx tsx src/main.ts addData guServiceSupport "$file"
done