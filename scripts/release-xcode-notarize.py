#!/usr/bin/env python3
"""Archive a prepared SwiftPM app and notarize with Xcode's signed-in account.

No account secrets are read or copied. The input must be the app just assembled
by release-macos.sh. Xcode supplies its own distribution authentication.
"""
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time


def make_project(work, team):
    def key(i):
        return f'{i:024X}'

    objects = {
        key(1): dict(isa='PBXProject', attributes={'LastUpgradeCheck': '2600'},
                     buildConfigurationList=key(3), compatibilityVersion='Xcode 14.0',
                     developmentRegion='en', hasScannedForEncodings=0, knownRegions=['en', 'Base'],
                     mainGroup=key(4), productRefGroup=key(5), projectDirPath='', projectRoot='',
                     targets=[key(2)]),
        key(2): dict(isa='PBXNativeTarget', buildConfigurationList=key(6), buildPhases=[key(7)],
                     buildRules=[], dependencies=[], name='Astra', productName='Astra',
                     productReference=key(8), productType='com.apple.product-type.application'),
        key(3): dict(isa='XCConfigurationList', buildConfigurations=[key(9)],
                     defaultConfigurationIsVisible=0, defaultConfigurationName='Release'),
        key(4): dict(isa='PBXGroup', children=[key(5)], sourceTree='<group>'),
        key(5): dict(isa='PBXGroup', children=[key(8)], name='Products', sourceTree='<group>'),
        key(6): dict(isa='XCConfigurationList', buildConfigurations=[key(10)],
                     defaultConfigurationIsVisible=0, defaultConfigurationName='Release'),
        key(7): dict(isa='PBXShellScriptBuildPhase', buildActionMask=2147483647, files=[],
                     inputPaths=[], outputPaths=[], runOnlyForDeploymentPostprocessing=0,
                     shellPath='/bin/sh', name='Install current SwiftPM product', shellScript='''set -eu
mkdir -p "$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH"
for part in MacOS Resources Frameworks; do
  if [ -d "$SRCROOT/prebuilt/Astra.app/Contents/$part" ]; then
    ditto "$SRCROOT/prebuilt/Astra.app/Contents/$part" "$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH/$part"
  fi
done
'''),
        key(8): dict(isa='PBXFileReference', explicitFileType='wrapper.application',
                     includeInIndex=0, path='Astra.app', sourceTree='BUILT_PRODUCTS_DIR'),
        key(9): dict(isa='XCBuildConfiguration', name='Release', buildSettings={
            'SDKROOT': 'macosx', 'MACOSX_DEPLOYMENT_TARGET': '14.0', 'ONLY_ACTIVE_ARCH': 'NO'}),
        key(10): dict(isa='XCBuildConfiguration', name='Release', buildSettings={
            'PRODUCT_NAME': 'Astra', 'EXECUTABLE_NAME': 'AstraMac',
            'PRODUCT_BUNDLE_IDENTIFIER': 'com.astra.desktop',
            'INFOPLIST_FILE': 'prebuilt/Astra.app/Contents/Info.plist', 'GENERATE_INFOPLIST_FILE': 'NO',
            'DEVELOPMENT_TEAM': team, 'CODE_SIGN_IDENTITY': 'Apple Development', 'CODE_SIGN_STYLE': 'Manual',
            'ENABLE_HARDENED_RUNTIME': 'YES', 'ENABLE_USER_SCRIPT_SANDBOXING': 'NO',
            'SKIP_INSTALL': 'NO', 'INSTALL_PATH': '$(LOCAL_APPS_DIR)',
            'CODE_SIGN_ENTITLEMENTS': 'astra.entitlements'}),
    }
    project = work / 'AstraDistribution.xcodeproj'
    project.mkdir()
    (project / 'project.pbxproj').write_bytes(plistlib.dumps(dict(
        archiveVersion='1', classes={}, objectVersion='56', objects=objects, rootObject=key(1))))
    return project


def run(args, log=None):
    if log:
        with log.open('w') as output:
            result = subprocess.run(args, stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            print(f'Command failed ({result.returncode}); log: {log}', flush=True)
        return result.returncode
    return subprocess.run(args, check=True).returncode


def main():
    # Provisioning test accounts is unrelated to Apple signing. Do not pass
    # those credentials or meeting URLs into Xcode's build-script environment.
    for name in tuple(os.environ):
        if name.startswith(('ASTRA_TEST_', 'ASTRA_MEET_')):
            del os.environ[name]
    app = Path(sys.argv[1]).resolve()
    entitlements = Path(sys.argv[2]).resolve()
    team = sys.argv[3]
    work = Path(tempfile.mkdtemp(prefix='astra-xcode-', dir=app.parent))
    print(f'XCODE_NOTARIZATION_WORK={work}', flush=True)
    source = work / 'prebuilt' / 'Astra.app'
    source.parent.mkdir()
    run(['ditto', str(app), str(source)])
    shutil.copy2(entitlements, work / 'astra.entitlements')
    # Xcode validates nested executables before distribution signing. The
    # development archive must already opt every Sparkle helper into runtime.
    framework = source / 'Contents/Frameworks/Sparkle.framework'
    nested = [p for p in framework.rglob('*') if not p.is_symlink()
              and (p.suffix in ('.app', '.xpc') or p.name == 'Autoupdate')]
    for target in sorted(nested, key=lambda p: len(p.parts), reverse=True) + [framework]:
        run(['codesign', '--force', '--timestamp', '--options', 'runtime', '--sign',
             'Apple Development', str(target)])
    project = make_project(work, team)
    archive = work / 'Astra.xcarchive'
    if run(['xcodebuild', '-project', str(project), '-scheme', 'Astra', '-configuration', 'Release',
            '-archivePath', str(archive), 'archive'], work / 'archive.log'):
        return 1
    options = work / 'ExportOptions.plist'
    options.write_bytes(plistlib.dumps(dict(method='developer-id', destination='upload',
                                           signingStyle='automatic', teamID=team,
                                           manageAppVersionAndBuildNumber=False, stripSwiftSymbols=True)))
    if run(['xcodebuild', '-exportArchive', '-archivePath', str(archive), '-exportOptionsPlist',
            str(options), '-exportPath', str(work / 'upload'), '-allowProvisioningUpdates'],
           work / 'upload.log'):
        return 1
    print('XCODE_NOTARIZATION=UPLOADED (not yet a distribution verdict)', flush=True)
    exported = work / 'notarized'
    deadline = time.monotonic() + 900
    while True:
        if run(['xcodebuild', '-exportNotarizedApp', '-archivePath', str(archive),
                '-exportPath', str(exported)], work / 'export.log') == 0:
            break
        if time.monotonic() >= deadline:
            print(f'XCODE_NOTARIZATION=NOT_READY; retry export from {archive}', flush=True)
            return 3
        time.sleep(30)
    candidate = exported / 'Astra.app'
    run(['codesign', '--verify', '--deep', '--strict', str(candidate)])
    run(['xcrun', 'stapler', 'validate', str(candidate)])
    run(['spctl', '--assess', '--type', 'execute', '--verbose=4', str(candidate)])
    details = subprocess.check_output(['codesign', '-dv', '--verbose=2', str(candidate)],
                                      stderr=subprocess.STDOUT, text=True)
    if 'Authority=Developer ID Application:' not in details or f'TeamIdentifier={team}' not in details:
        raise ValueError('notarized app has an unexpected signing identity')
    original_info = plistlib.loads((source / 'Contents/Info.plist').read_bytes())
    exported_info = plistlib.loads((candidate / 'Contents/Info.plist').read_bytes())
    for field in ('CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion'):
        if original_info[field] != exported_info[field]:
            raise ValueError(f'Xcode changed {field}')
    archs = subprocess.check_output(['lipo', '-archs', str(candidate / 'Contents/MacOS/AstraMac')], text=True)
    if set(archs.split()) != {'arm64', 'x86_64'}:
        raise ValueError(f'not a Universal app: {archs}')
    os.rename(app, work / 'unsigned-original.app')
    run(['ditto', str(candidate), str(app)])
    print('XCODE_NOTARIZATION=PASS', flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'XCODE_NOTARIZATION=FAIL {error}', file=sys.stderr)
        sys.exit(1)
