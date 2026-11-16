"""Process-local network transport denial for disposable public regressions.

macOS inherits the wrapper's sandbox-exec network profile. Linux uses only the
operating system's existing libseccomp.so.2 API; no library is installed or copied.
The original real socket/connect assertion verifies denial before any test runs.
Unsupported platforms or unavailable kernel enforcement fail without skips.
"""
import ctypes
import errno
import sys


def enforce_network_denial():
    if sys.platform == 'darwin':
        # The actual inherited sandbox is checked by the caller's unchanged
        # socket assertion. This branch never synthesizes an access error.
        return
    if sys.platform != 'linux':
        raise RuntimeError('Actual kernel network denial is unsupported on this platform')
    library = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    library.seccomp_init.argtypes = [ctypes.c_uint32]
    library.seccomp_init.restype = ctypes.c_void_p
    library.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    library.seccomp_syscall_resolve_name.restype = ctypes.c_int
    library.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    library.seccomp_rule_add.restype = ctypes.c_int
    library.seccomp_load.argtypes = [ctypes.c_void_p]
    library.seccomp_load.restype = ctypes.c_int
    library.seccomp_release.argtypes = [ctypes.c_void_p]
    library.seccomp_release.restype = None
    # Permit ordinary file/pipe/process fixture work and socket allocation, but
    # deny actual transport. The frozen assertion creates its socket before it
    # asks the kernel to connect, so socket creation alone is not denied.
    context = library.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
    if not context:
        raise RuntimeError('Kernel filter context could not be created')
    try:
        action = 0x00050000 | errno.EPERM  # SCMP_ACT_ERRNO(EPERM)
        for name in ('connect', 'bind', 'listen', 'accept', 'accept4', 'sendto',
                     'sendmsg', 'sendmmsg', 'recvfrom', 'recvmsg', 'recvmmsg'):
            number = library.seccomp_syscall_resolve_name(name.encode('ascii'))
            if number < 0 or library.seccomp_rule_add(context, action, number, 0) != 0:
                raise RuntimeError('Required kernel transport rule unavailable: ' + name)
        if library.seccomp_load(context) != 0:
            raise RuntimeError('Kernel network filter could not be activated')
    finally:
        # Freeing the userspace builder never removes the inherited kernel filter.
        library.seccomp_release(context)
