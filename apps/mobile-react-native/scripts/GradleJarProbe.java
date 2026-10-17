import java.nio.file.*;
import java.util.*;

/** Read-only reproduction of the Windows path/ZIP failure, independent of CPIK. */
public class GradleJarProbe {
  public static void main(String[] args) throws Exception {
    if (args.length != 1) {
      throw new IllegalArgumentException("Supply the path to a real Gradle JAR");
    }
    Path jar = Path.of(args[0]);
    boolean failed = false;
    System.out.println("java=" + System.getProperty("java.version"));
    System.out.println("exists=" + Files.exists(jar) + ", readable=" + Files.isReadable(jar));
    System.out.println("size=" + Files.size(jar));
    try { System.out.println("realPath=" + jar.toRealPath()); }
    catch (Exception error) { failed = true; error.printStackTrace(); }
    try (FileSystem zip = FileSystems.newFileSystem(jar, Map.of())) {
      System.out.println("zipRoot=" + zip.getRootDirectories().iterator().next());
    } catch (Exception error) { failed = true; error.printStackTrace(); }
    if (failed) { System.exit(1); }
  }
}
