#!/bin/bash

# Create ZIP and XPI archives with required files
zip -r FuzzyTabEnhanced.zip icons/ background.js microfuzz.bundle.js app.js app.html app.css manifest.json
cp FuzzyTabEnhanced.zip FuzzyTabEnhanced.xpi

# Check if zip command was successful
if [ $? -eq 0 ]; then
    echo "Extension packages (FuzzyTabEnhanced.zip and FuzzyTabEnhanced.xpi) created successfully!"
else
    echo "Error creating extension package"
    exit 1
fi
