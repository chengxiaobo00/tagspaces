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
function splitNameExt(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0
    ? { base: name.slice(0, dot), ext: name.slice(dot) }
    : { base: name, ext: '' };
}

// Best-effort base name + original extension from a URL.
function deriveNameFromUrl(urlStr: string): { base: string; ext: string } {
  let fileName: string;
  let pathParts: string[];
  const url = new URL(urlStr);
  if (url.pathname) {
    const i = url.pathname.lastIndexOf('/');
    if (i > -1) {
      fileName = url.pathname.substring(i + 1);
      if (!fileName) {
        pathParts = url.pathname.split('/').filter(Boolean);
      }
    } else {
      fileName = url.pathname;
    }
  }
  if (!fileName) {
    fileName = `${
      url.hostname +
      (pathParts && pathParts.length > 0 ? pathParts.join('-') : '')
    }.html`;
  } else if (fileName.indexOf('.') === -1) {
    fileName = `${url.hostname}-${fileName}.html`;
  }
  return splitNameExt(sanitizeDownloadFileName(fileName) || 'download.html');
}

// Extension implied by the chosen save format (clipped formats override the
// page's original extension).
function extForFormat(format: SaveFormat, originalExt: string): string {
  if (format === 'markdown') return '.md';
  if (format === 'html') return '.html';
  return originalExt || '.html';
}

function DownloadUrlDialog(props: Props) {
  const { open, onClose } = props;
  const { t } = useTranslation();
  const theme = useTheme();
  const smallScreen = useMediaQuery(theme.breakpoints.down('md'));
  const { setReflectActions } = useEditedEntryContext();
  const { currentLocation } = useCurrentLocationContext();
  const { downloadUrl, downloadUrlAs } = useIOActionsContext();
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
  // Original extension derived from the URL, used when format is "original".
  const originalExt = useRef<string>('.html');
  const [invalidURL, setInvalidURL] = useState<boolean>(false);
  const [saveFormat, setSaveFormat] = useState<SaveFormat>('original');
  const [extractArticle, setExtractArticle] = useState<boolean>(false);
  const [embedImages, setEmbedImages] = useState<boolean>(true);

  // Reset the form and seed an automatic datetime-stamp tag each time the
  // (kept-mounted) dialog opens.
  useEffect(() => {
    if (open) {
      setUrl('');
      setFileName('');
      originalExt.current = '.html';
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
      originalExt.current = ext;
      setFileName(base + extForFormat(saveFormat, ext));
    } catch (e) {
      // incomplete/invalid URL — leave the filename as-is
    }
  };

  const handleFormatChange = (_event, value: SaveFormat) => {
    if (!value) return;
    setSaveFormat(value);
    setFileName(
      (prev) =>
        splitNameExt(prev).base + extForFormat(value, originalExt.current),
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
    const baseName =
      fileName || `download${extForFormat(saveFormat, originalExt.current)}`;
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

    if (canConvert && saveFormat !== 'original') {
      // Cleaned-HTML / Markdown clip: fetch the page, strip scripts, inline
      // images and optionally extract the article, then save into the location.
      downloadUrlAs(url, targetPath, saveFormat, {
        extractArticle,
        embedImages,
        tags: tagTitles.join(', '),
      })
        .then(reflectOpen)
        .catch(notifyError);
    } else if (AppConfig.isElectron || AppConfig.isNativeMobile) {
      // Raw download straight into the location (local + cloud + mobile),
      // routed through the platform's CORS/CSP-free fetch.
      dispatch(AppActions.resetProgress());
      openFileUploadDialog();
      downloadUrl(url, targetPath, onUploadProgress)
        .then(reflectOpen)
        .catch(notifyError);
    } else {
      // Web app: browser CSP/CORS cannot be bypassed — fall back to a plain
      // browser download.
      saveAs(url, finalName);
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
                <TsToggleButton value="html" data-tid="downloadFormatHtmlTID">
                  {t('core:cleanedHtml')}
                </TsToggleButton>
                <TsToggleButton
                  value="markdown"
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
