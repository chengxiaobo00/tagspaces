/**
 * TagSpaces - universal file and folder organizer
 * Copyright (C) 2017-present TagSpaces GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License (version 3) as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 */

import AppConfig from '-/AppConfig';
import DraggablePaper from '-/components/DraggablePaper';
import TagsSelect from '-/components/TagsSelect';
import TsButton from '-/components/TsButton';
import TsSwitch from '-/components/TsSwitch';
import TsTextField from '-/components/TsTextField';
import TsToggleButton from '-/components/TsToggleButton';
import TargetPath from '-/components/dialogs/components/TargetPath';
import TsDialogActions from '-/components/dialogs/components/TsDialogActions';
import TsDialogTitle from '-/components/dialogs/components/TsDialogTitle';
import { TargetPathContextProvider } from '-/components/dialogs/hooks/TargetPathContextProvider';
import { useFileUploadDialogContext } from '-/components/dialogs/hooks/useFileUploadDialogContext';
import { useTargetPathContext } from '-/components/dialogs/hooks/useTargetPathContext';
import { useCurrentLocationContext } from '-/hooks/useCurrentLocationContext';
import { useEditedEntryContext } from '-/hooks/useEditedEntryContext';
import { useIOActionsContext } from '-/hooks/useIOActionsContext';
import { useNotificationContext } from '-/hooks/useNotificationContext';
import { getExtensionForMimeType } from '-/services/utils-io';
import { actions as AppActions, AppDispatch } from '-/reducers/app';
import {
  getFileNameTagPlace,
  getPrefixTagContainer,
  getTagColor,
  getTagDelimiter,
  getTagTextColor,
} from '-/reducers/settings';
import { TS } from '-/tagspaces.namespace';
import {
  Box,
  FormControl,
  FormControlLabel,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Paper from '@mui/material/Paper';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { formatDateTime4Tag } from '@tagspaces/tagspaces-common/misc';
import { generateFileName } from '@tagspaces/tagspaces-common/paths';
import { getUuid } from '@tagspaces/tagspaces-common/utils-io';
import { saveAs } from 'file-saver';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

interface Props {
  open: boolean;
  onClose: (event?: Object, reason?: string) => void;
}

type SaveFormat = 'original' | 'html' | 'markdown';

// Derive a safe, single-segment filename from a URL-derived name. Decoding the
// raw name can reintroduce path separators / `..` (e.g. "%2e%2e%2f"), so keep
// only the final segment and drop traversal/control characters to prevent
// writing outside the chosen target directory.
function sanitizeDownloadFileName(name: string): string {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch (e) {
    // keep the raw name if it isn't valid percent-encoding
  }
  const base = decoded.split(/[/\\]/).pop() || '';
  const cleaned = Array.from(base)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('');
  return /^\.+$/.test(cleaned) ? '' : cleaned;
}

// Split a sanitized filename into base name and extension (incl. leading dot).
// Only a real-looking extension counts (≤8 chars, contains a letter), so a
// numeric suffix such as the arXiv id "2605.22391" is kept as part of the name
// rather than mistaken for an extension.
function splitNameExt(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const ext = name.slice(dot);
    if (/^\.[a-z0-9]{1,8}$/i.test(ext) && /[a-z]/i.test(ext)) {
      return { base: name.slice(0, dot), ext };
    }
  }
  return { base: name, ext: '' };
}

// Best-effort base name + extension from a URL. Uses the last non-empty path
// segment (so `…/blog/my-article` and `…/blog/my-article/` both yield
// `my-article`); for a bare host or "/" it falls back to the hostname. An
// extension-less segment (article slug) or the hostname defaults to `.html`,
// while a real file segment keeps its extension (`photo.jpg`, `report.pdf`).
function deriveNameFromUrl(urlStr: string): { base: string; ext: string } {
  const url = new URL(urlStr);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length > 0) {
    const last = sanitizeDownloadFileName(segments[segments.length - 1]);
    const { base, ext } = splitNameExt(last);
    return {
      base: base || sanitizeDownloadFileName(url.hostname) || 'download',
      ext: ext || '.html',
    };
  }
  // No usable path — keep the whole hostname (e.g. "pi.dev") as the base name;
  // its dots aren't a file extension, so don't split on them.
  return {
    base: sanitizeDownloadFileName(url.hostname) || 'download',
    ext: '.html',
  };
}

// Extension implied by the chosen save format (clipped formats override the
// page's original extension).
function extForFormat(format: SaveFormat, originalExt: string): string {
  if (format === 'markdown') return '.md';
  if (format === 'html') return '.html';
  return originalExt || '.html';
}

// Whether a (lower-cased) extension is an HTML document — these get sanitized
// (script/link stripped) even in "Original" mode; everything else (images, PDF,
// archives, …) is downloaded raw.
function isHtmlExtension(ext: string): boolean {
  return ['.html', '.htm', '.xhtml', ''].includes(ext.toLowerCase());
}

function DownloadUrlDialog(props: Props) {
  const { open, onClose } = props;
  const { t } = useTranslation();
  const theme = useTheme();
  const smallScreen = useMediaQuery(theme.breakpoints.down('md'));
  const { setReflectActions } = useEditedEntryContext();
  const { currentLocation } = useCurrentLocationContext();
  const { downloadUrl, downloadUrlAs, inspectUrl, probeContentType } =
    useIOActionsContext();
  const { showNotification } = useNotificationContext();
  const { openFileUploadDialog } = useFileUploadDialogContext();
  const dispatch: AppDispatch = useDispatch();

  const tagDelimiter = useSelector(getTagDelimiter);
  const prefixTagContainer = useSelector(getPrefixTagContainer);
  const filenameTagPlacedAtEnd = useSelector(getFileNameTagPlace);
  const defaultTagColor = useSelector(getTagColor);
  const defaultTagTextColor = useSelector(getTagTextColor);

  // Cleaned-HTML / Markdown conversion needs CORS/CSP-free fetching of the page
  // and its images — only the desktop and native-mobile builds can do that.
  const canConvert = AppConfig.isElectron || AppConfig.isNativeMobile;

  const { targetDirectoryPath } = useTargetPathContext();
  const [url, setUrl] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [tags, setTags] = useState<TS.Tag[]>([]);
  const inputTags = useRef<TS.Tag[]>([]);
  // Source content's extension (from the URL or sniffed Content-Type), used as
  // the "original" extension and to decide whether conversion is allowed. State
  // so the convert gate re-renders when a PDF/image is recognized.
  const [originalExt, setOriginalExt] = useState<string>('.html');
  const [invalidURL, setInvalidURL] = useState<boolean>(false);
  const [saveFormat, setSaveFormat] = useState<SaveFormat>('original');
  const [extractArticle, setExtractArticle] = useState<boolean>(false);
  const [embedImages, setEmbedImages] = useState<boolean>(true);

  // HTML/Markdown conversion only makes sense for real HTML — disable it when
  // the source is a non-HTML file (PDF, image, …) by extension or Content-Type.
  const convertDisabled = !isHtmlExtension(originalExt);

  // Reset the form and seed an automatic datetime-stamp tag each time the
  // (kept-mounted) dialog opens.
  useEffect(() => {
    if (open) {
      setUrl('');
      setFileName('');
      setOriginalExt('.html');
      setSaveFormat('original');
      setExtractArticle(false);
      setEmbedImages(true);
      setInvalidURL(false);
      inputTags.current = [];
      setTags([
        {
          id: getUuid(),
          title: formatDateTime4Tag(new Date(), true),
          color: defaultTagColor,
          textcolor: defaultTagTextColor,
        },
      ]);
    }
    // Reset only on open/close; default tag colors are read at seed time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // On URL entry, cheaply probe the Content-Type (headers only) so a PDF/image
  // served from an extension-less URL (e.g. arxiv.org/pdf/...) is recognized:
  // the extension is corrected and conversion gets disabled. Debounced + cached.
  const probeCache = useRef<{ url: string; promise: Promise<string> }>();
  useEffect(() => {
    if (!open || !/^https?:\/\//i.test(url)) {
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!probeCache.current || probeCache.current.url !== url) {
        probeCache.current = { url, promise: probeContentType(url) };
      }
      probeCache.current.promise
        .then((contentType) => {
          if (cancelled) {
            return undefined;
          }
          // Recognize binary types (PDF/image/zip/…) that can't be converted;
          // ignore HTML/unknown so an HTML page keeps its URL-derived name.
          const mapped = getExtensionForMimeType(contentType);
          const ext = mapped ? `.${mapped}` : null;
          if (ext && !isHtmlExtension(ext)) {
            setOriginalExt(ext);
            setSaveFormat('original');
            setFileName((prev) => splitNameExt(prev).base + ext);
          }
          return undefined;
        })
        .catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // probeContentType is a stable context fn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, open]);

  // When a conversion format is selected, fetch the page (debounced, cached per
  // URL) to (a) default "Extract main article" on only for a parseable article
  // and (b) detect a PDF body served without a Content-Type — revert to Original.
  const inspectCache = useRef<{
    url: string;
    promise: ReturnType<typeof inspectUrl>;
  }>();
  useEffect(() => {
    if (!open || saveFormat === 'original' || !/^https?:\/\//i.test(url)) {
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!inspectCache.current || inspectCache.current.url !== url) {
        inspectCache.current = { url, promise: inspectUrl(url) };
      }
      inspectCache.current.promise
        .then((info) => {
          if (cancelled) {
            return info;
          }
          if (info.isPdf) {
            // PDF body served from an HTML-looking URL — correct the extension
            // and fall back to a raw "Original" download.
            setOriginalExt('.pdf');
            setSaveFormat('original');
            setFileName((prev) => `${splitNameExt(prev).base}.pdf`);
          } else {
            setExtractArticle(info.readerable);
          }
          return info;
        })
        .catch(() => {});
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // inspectUrl is a stable context fn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, saveFormat, open]);

  const onUploadProgress = (progress, abort, fileName2) => {
    dispatch(AppActions.onUploadProgress(progress, abort, fileName2));
  };

  const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setUrl(value);
    if (invalidURL) {
      setInvalidURL(false);
    }
    try {
      const { base, ext } = deriveNameFromUrl(value);
      setOriginalExt(ext);
      setFileName(base + extForFormat(saveFormat, ext));
    } catch (e) {
      // incomplete/invalid URL — leave the filename as-is
    }
  };

  const handleFormatChange = (_event, value: SaveFormat) => {
    if (!value) return;
    setSaveFormat(value);
    setFileName(
      (prev) => splitNameExt(prev).base + extForFormat(value, originalExt),
    );
  };

  function uniqueTags(tagsArray: TS.Tag[]): TS.Tag[] {
    return tagsArray.reduce((acc: TS.Tag[], current) => {
      if (!acc.some((item) => item.title === current.title)) {
        acc.push(current);
      }
      return acc;
    }, []);
  }

  const handleTagsChange = (
    name: string,
    value: Array<TS.Tag>,
    action: string,
  ) => {
    if (action === 'remove-value') {
      const toRemove = value.map((tag) => tag.title);
      setTags(tags.filter((tag) => !toRemove.includes(tag.title)));
    } else {
      setTags(value);
    }
  };

  const handleNewTags = (newTags: TS.Tag[]) => {
    if (newTags === undefined) {
      if (inputTags.current.length > 0) {
        setTags(uniqueTags([...tags, ...inputTags.current]));
        inputTags.current = [];
      }
    } else {
      inputTags.current = newTags;
    }
  };

  function downloadURL() {
    if (!url) {
      return;
    }
    try {
      // Validate the URL — throws for an incomplete entry.
      // eslint-disable-next-line no-new
      new URL(url);
    } catch (ex) {
      setInvalidURL(true);
      return;
    }

    // Embed the picked tags (plus any tag typed but not yet committed) into the
    // filename: name[tag1 tag2].ext
    const allTags = uniqueTags([...tags, ...inputTags.current]);
    const tagTitles = allTags.map((tag) => tag.title);
    // Re-sanitize the (user-editable) filename so a typed/pasted "../" can't
    // escape the target directory — generateFileName doesn't strip separators.
    const baseName =
      sanitizeDownloadFileName(fileName) ||
      `download${extForFormat(saveFormat, originalExt)}`;
    const finalName = generateFileName(
      baseName,
      tagTitles,
      tagDelimiter,
      currentLocation?.getDirSeparator(),
      prefixTagContainer,
      filenameTagPlacedAtEnd,
    );
    const targetPath = `${targetDirectoryPath}/${finalName}`;

    const reflectOpen = (entry: TS.FileSystemEntry) => {
      setReflectActions({
        action: 'add',
        entry,
        open: true,
        source: 'upload',
      });
    };
    const notifyError = (e: Error) => {
      console.log('downloadFile error:', e);
      dispatch(AppActions.setProgress(url, -1, t('core:errorCORS')));
      showNotification(
        t('core:downloadFileError', { message: e.message }),
        'error',
        true,
      );
    };

    const tagsCsv = tagTitles.join(', ');
    const isHtml = isHtmlExtension(splitNameExt(fileName).ext);

    if (!canConvert) {
      // Web app: browser CSP/CORS cannot be bypassed — fall back to a plain
      // browser download (the menu entry is hidden on web anyway).
      saveAs(url, finalName);
    } else if (saveFormat === 'markdown') {
      // Convert the page to Markdown.
      downloadUrlAs(url, targetPath, 'markdown', {
        extractArticle,
        embedImages,
        tags: tagsCsv,
      })
        .then(reflectOpen)
        .catch(notifyError);
    } else if (saveFormat === 'html') {
      // Cleaned HTML: strip scripts, links AND styles/CSS.
      downloadUrlAs(url, targetPath, 'html', {
        stripStyles: true,
        extractArticle,
        embedImages,
        tags: tagsCsv,
      })
        .then(reflectOpen)
        .catch(notifyError);
    } else if (isHtml) {
      // Original HTML: keep the page intact but strip <script> and <link>.
      downloadUrlAs(url, targetPath, 'html', {
        stripStyles: false,
        extractArticle: false,
        embedImages: false,
        tags: tagsCsv,
      })
        .then(reflectOpen)
        .catch(notifyError);
    } else {
      // Original non-HTML (image, PDF, archive, …): raw binary download via the
      // platform's CORS/CSP-free fetch, streamed straight into the location.
      dispatch(AppActions.resetProgress());
      openFileUploadDialog();
      downloadUrl(url, targetPath, onUploadProgress)
        .then(reflectOpen)
        .catch(notifyError);
    }
    onClose();
  }

  const okButton = (
    <TsButton
      variant="contained"
      data-tid="downloadFileUrlTID"
      disabled={!url}
      onClick={() => downloadURL()}
      sx={
        {
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties & { WebkitAppRegion?: string }
      }
    >
      {t('core:ok')}
    </TsButton>
  );

  return (
    <TargetPathContextProvider>
      <Dialog
        open={open}
        onClose={onClose}
        fullScreen={smallScreen}
        keepMounted
        aria-labelledby="draggable-dialog-title"
        PaperComponent={smallScreen ? Paper : DraggablePaper}
        scroll="paper"
      >
        <TsDialogTitle
          dialogTitle={t('core:downloadLink')}
          closeButtonTestId="closeDownloadURLDialogTID"
          onClose={onClose}
          actionSlot={okButton}
        />
        <DialogContent
          sx={{
            minWidth: '250px',
            marginBottom: '20px',
            overflow: 'overlay',
          }}
          data-tid="downloadUrlDialogTID"
        >
          <TsTextField
            error={invalidURL}
            label={t('core:url')}
            autoFocus
            name="name"
            value={url}
            data-tid="newUrlTID"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                downloadURL();
              }
            }}
            onChange={handleUrlChange}
          />
          {url && (
            <FormControl fullWidth sx={{ mt: 2 }}>
              <TsTextField
                label={t('core:fileName')}
                name="downloadFileName"
                value={fileName}
                data-tid="downloadFileNameTID"
                onChange={(event) => setFileName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    downloadURL();
                  }
                }}
              />
            </FormControl>
          )}
          <Box sx={{ mt: 2 }}>
            <TagsSelect
              dataTid="downloadUrlTagsSelectTID"
              placeholderText={t('core:selectTags')}
              label={t('core:fileTags')}
              tags={tags}
              handleChange={handleTagsChange}
              handleNewTags={handleNewTags}
              tagMode="default"
            />
          </Box>
          <TargetPath />
          {canConvert && (
            <Box sx={{ mt: 2 }}>
              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ display: 'block', mb: 0.5 }}
              >
                {t('core:saveAs')}
              </Typography>
              <ToggleButtonGroup
                size="small"
                value={saveFormat}
                exclusive
                onChange={handleFormatChange}
                data-tid="downloadFormatToggleTID"
              >
                <TsToggleButton
                  value="original"
                  data-tid="downloadFormatOriginalTID"
                >
                  {t('core:originalFile')}
                </TsToggleButton>
                <TsToggleButton
                  value="html"
                  disabled={convertDisabled}
                  data-tid="downloadFormatHtmlTID"
                >
                  {t('core:cleanedHtml')}
                </TsToggleButton>
                <TsToggleButton
                  value="markdown"
                  disabled={convertDisabled}
                  data-tid="downloadFormatMarkdownTID"
                >
                  {t('core:markdown')}
                </TsToggleButton>
              </ToggleButtonGroup>
              {saveFormat !== 'original' && (
                <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column' }}>
                  <FormControlLabel
                    labelPlacement="start"
                    sx={{ ml: 0, justifyContent: 'space-between' }}
                    control={
                      <TsSwitch
                        checked={extractArticle}
                        onChange={(e) => setExtractArticle(e.target.checked)}
                        data-tid="downloadExtractArticleTID"
                      />
                    }
                    label={t('core:extractMainArticle')}
                  />
                  <FormControlLabel
                    labelPlacement="start"
                    sx={{ ml: 0, justifyContent: 'space-between' }}
                    control={
                      <TsSwitch
                        checked={embedImages}
                        onChange={(e) => setEmbedImages(e.target.checked)}
                        data-tid="downloadEmbedImagesTID"
                      />
                    }
                    label={t('core:embedImages')}
                  />
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        {!smallScreen && (
          <TsDialogActions>
            <TsButton onClick={onClose}>{t('core:cancel')}</TsButton>
            {okButton}
          </TsDialogActions>
        )}
      </Dialog>
    </TargetPathContextProvider>
  );
}

export default DownloadUrlDialog;
