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
import TsButton from '-/components/TsButton';
import TsTextField from '-/components/TsTextField';
import TsToggleButton from '-/components/TsToggleButton';
import TargetPath from '-/components/dialogs/components/TargetPath';
import TsDialogActions from '-/components/dialogs/components/TsDialogActions';
import TsDialogTitle from '-/components/dialogs/components/TsDialogTitle';
import { TargetPathContextProvider } from '-/components/dialogs/hooks/TargetPathContextProvider';
import { useFileUploadDialogContext } from '-/components/dialogs/hooks/useFileUploadDialogContext';
import { useTargetPathContext } from '-/components/dialogs/hooks/useTargetPathContext';
import { useEditedEntryContext } from '-/hooks/useEditedEntryContext';
import { useIOActionsContext } from '-/hooks/useIOActionsContext';
import { useNotificationContext } from '-/hooks/useNotificationContext';
import { actions as AppActions, AppDispatch } from '-/reducers/app';
import { TS } from '-/tagspaces.namespace';
import {
  Box,
  Checkbox,
  FormControlLabel,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Paper from '@mui/material/Paper';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { saveAs } from 'file-saver';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';

interface Props {
  open: boolean;
  onClose: (event?: Object, reason?: string) => void;
}

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

function DownloadUrlDialog(props: Props) {
  const { open, onClose } = props;
  const { t } = useTranslation();
  const theme = useTheme();
  const smallScreen = useMediaQuery(theme.breakpoints.down('md'));
  const { setReflectActions } = useEditedEntryContext();
  const { downloadUrl, downloadUrlAs } = useIOActionsContext();
  const { showNotification } = useNotificationContext();
  const { openFileUploadDialog } = useFileUploadDialogContext();
  const dispatch: AppDispatch = useDispatch();

  // Cleaned-HTML / Markdown conversion needs CORS/CSP-free fetching of the page
  // and its images — only the desktop and native-mobile builds can do that.
  const canConvert = AppConfig.isElectron || AppConfig.isNativeMobile;

  const { targetDirectoryPath } = useTargetPathContext();
  const fileUrl = useRef<string>();
  const [invalidURL, setInvalidURL] = useState<boolean>(false);
  const [saveFormat, setSaveFormat] = useState<
    'original' | 'html' | 'markdown'
  >('original');
  const [extractArticle, setExtractArticle] = useState<boolean>(false);
  const [embedImages, setEmbedImages] = useState<boolean>(true);

  const onUploadProgress = (progress, abort, fileName) => {
    dispatch(AppActions.onUploadProgress(progress, abort, fileName));
  };

  const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    fileUrl.current = event.target.value;
  };

  function downloadURL() {
    if (fileUrl.current) {
      try {
        const url = new URL(fileUrl.current);
        if (invalidURL) {
          setInvalidURL(false);
        }
        let fileName;
        let pathParts;
        if (url.pathname) {
          const delimiterIndex = url.pathname.lastIndexOf('/');
          if (delimiterIndex > -1) {
            fileName = url.pathname.substring(delimiterIndex + 1);
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

        const reflectOpen = (entry: TS.FileSystemEntry) => {
          const reflectAction: TS.EditAction = {
            action: 'add',
            entry,
            open: true,
            source: 'upload',
          };
          setReflectActions(reflectAction);
        };
        const notifyError = (e: Error) => {
          console.log('downloadFile error:', e);
          dispatch(
            AppActions.setProgress(fileUrl.current, -1, t('core:errorCORS')),
          );
          showNotification(
            t('core:downloadFileError', { message: e.message }),
            'error',
            true,
          );
        };

        const safeFileName =
          sanitizeDownloadFileName(fileName) || 'download.html';

        if (canConvert && saveFormat !== 'original') {
          // Cleaned-HTML / Markdown clip: fetch the page, strip scripts, inline
          // images and optionally extract the article, then save into the location.
          const baseName = safeFileName.replace(/\.[^.]+$/, '') || 'download';
          const ext = saveFormat === 'markdown' ? '.md' : '.html';
          downloadUrlAs(
            fileUrl.current,
            `${targetDirectoryPath}/${baseName}${ext}`,
            saveFormat,
            { extractArticle, embedImages },
          )
            .then(reflectOpen)
            .catch(notifyError);
        } else if (AppConfig.isElectron || AppConfig.isNativeMobile) {
          // Raw download straight into the location (local + cloud + mobile),
          // routed through the platform's CORS/CSP-free fetch.
          dispatch(AppActions.resetProgress());
          openFileUploadDialog();
          downloadUrl(
            fileUrl.current,
            `${targetDirectoryPath}/${safeFileName}`,
            onUploadProgress,
          )
            .then(reflectOpen)
            .catch(notifyError);
        } else {
          // Web app: browser CSP/CORS cannot be bypassed — fall back to a plain
          // browser download.
          saveAs(fileUrl.current, safeFileName);
        }
        onClose();
      } catch (ex) {
        setInvalidURL(true);
        console.log('downloadURL', ex);
      }
    }
  }

  const okButton = (
    <TsButton
      variant="contained"
      data-tid="downloadFileUrlTID"
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
            minWidth: '200px',
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
            data-tid="newUrlTID"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                downloadURL();
              }
            }}
            onChange={handleUrlChange}
          />
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
                onChange={(_, v) => {
                  if (v) setSaveFormat(v);
                }}
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
                <Box sx={{ mt: 1 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={extractArticle}
                        onChange={(e) => setExtractArticle(e.target.checked)}
                        data-tid="downloadExtractArticleTID"
                      />
                    }
                    label={t('core:extractMainArticle')}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
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
