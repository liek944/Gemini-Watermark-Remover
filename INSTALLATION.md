# 📥 Installation Guide

## ⚠️ IMPORTANT: Read This First

This extension includes a large AI model (\~200MB). Because of this, **please do not use the "Download ZIP" button** on GitHub.

Using "Download ZIP" will fail to download the AI model correctly (you will get a tiny 1KB file instead of the real model), and the extension will not work.

**Please use the `git clone` method described below.**

-----

## Step 1: Get the Files (The Right Way)

You need to use **Git** to download this project. If you don't have Git installed, [download it here](https://www.google.com/search?q=https://git-scm.com/downloads) and install it (keep all default settings).

1.  Open your **Terminal** (Command Prompt or PowerShell on Windows, Terminal on Mac/Linux).
2.  Run the following command to enable Large File Storage support:
    ```bash
    git lfs install
    ```
3.  Run the command to download the project and the AI model:
    ```bash
    git clone https://github.com/dinoBOLT/Gemini-Watermark-Remover.git
    ```
    *(Wait for the download to finish. It might take a minute depending on your internet connection).*

-----

## Step 2: Load the Extension in Chrome

Once the download is complete, you need to load the folder into your browser.

1.  Open **Google Chrome**.
2.  Type `chrome://extensions/` in the address bar and press Enter.
3.  In the top-right corner, make sure **Developer mode** is turned **ON**.
4.  Click the **Load unpacked** button (top-left).
5.  Select the folder `Gemini-Watermark-Remover` that you just cloned.
      * *Note: Make sure you select the folder that contains the `manifest.json` file.*

The extension icon should now appear in your browser toolbar\! 🎉

-----

## Step 3: Verify the Installation

To make sure the AI model was downloaded correctly:

1.  Open the folder on your computer.
2.  Go to `src` -\> `assets`.
3.  Check the file named **`lama_fp32.onnx`**.
4.  **It should be around 198 MB.**
      * *If it is only 1 KB (or very small), it means Git LFS was not installed or you used the ZIP button.*
      * *Solution: Run `git lfs pull` inside the folder or re-do Step 1.*

-----

## Troubleshooting

**Error: "Failed to load AI model"**

  * Check your internet connection.
  * Ensure the `lama_fp32.onnx` file in `src/assets/` is \~198 MB.

**Error: "Manifest file is missing or unreadable"**

  * You probably selected the wrong folder. When clicking "Load unpacked", make sure you are selecting the folder directly containing the `manifest.json` file.

### Performance issues

- If processing is slow, close other Chrome tabs to free up memory
- The first run will be slower as the model loads; subsequent runs will be faster

## System Requirements

- **Browser**: Google Chrome (version 90+) or Chromium-based browsers
- **RAM**: At least 4 GB recommended (8 GB for optimal performance)
- **Storage**: ~250 MB for the extension and model
- **Internet**: Required only for the first model download

## Privacy Note

All processing happens locally in your browser. No images or data are sent to any external server. You can verify this by checking the Network tab in Chrome DevTools while using the extension.

## Uninstallation

To remove the extension:

1. Go to `chrome://extensions/`
2. Find "Gemini Watermark Remover"
3. Click **"Remove"**
4. Delete the extracted folder from your computer

## Need Help?

If you encounter any issues not covered here, please:

1. Check the [README.md](README.md) for more information
2. Open an issue on the [GitHub repository](https://github.com/your-username/gemini-watermark-remover/issues)
